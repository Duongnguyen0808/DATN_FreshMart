#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "src/qr-reader/ESP32QRCodeReader.h"
#include <time.h>
#include <esp_system.h>
#include <esp_http_server.h>
#include <img_converters.h>
#include <lwip/sockets.h>
#include "config.local.h"

#ifndef SERVER_QR_DECODING
#define SERVER_QR_DECODING 1
#endif

// VGA gives the QR decoder more detail than the default 320x240 frame.
ESP32QRCodeReader reader(CAMERA_MODEL_AI_THINKER, FRAMESIZE_VGA);
Preferences wifiPrefs;
String runtimeSsid = WIFI_SSID;
String runtimePassword = WIFI_PASSWORD;
String runtimeApiUrl = API_URL;
String serialBuffer;
bool triedFallbackWifi = false;
uint32_t bootId, sequence = 0, lastSend = 0, lastConnect = 0;
String lastCode;
bool cameraReady = false;
bool serviceStarted = false;
SemaphoreHandle_t previewLock;
uint8_t *previewJpeg = nullptr;
size_t previewLength = 0;
volatile uint32_t previewRequestedAt = 0;
uint32_t lastPreviewAt = 0;
bool previewAddressPrinted = false;
volatile int activeStreamSocket = -1;
volatile uint32_t activeStreamId = 0;
volatile uint32_t lastPostMs = 0;
volatile int lastHttpStatus = 0;

void printSerialStatus(const char *prefix = "FM_STATUS:") {
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;
  doc["warehouseId"] = WAREHOUSE_ID;
  doc["ssid"] = WiFi.status() == WL_CONNECTED ? WiFi.SSID() : runtimeSsid;
  doc["ip"] = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "";
  doc["apiUrl"] = runtimeApiUrl;
  doc["connected"] = WiFi.status() == WL_CONNECTED;
  String out;
  serializeJson(doc, out);
  Serial.printf("%s%s\n", prefix, out.c_str());
}

void loadSavedWifiConfig() {
  if (!wifiPrefs.begin("freshmart", true)) return;
  String savedSsid = wifiPrefs.getString("ssid", "");
  String savedPass = wifiPrefs.getString("pass", "");
  String savedApi = wifiPrefs.getString("apiUrl", "");
  wifiPrefs.end();
  if (savedSsid.length() > 0) {
    runtimeSsid = savedSsid;
    runtimePassword = savedPass;
  }
  if (savedApi.startsWith("http://") || savedApi.startsWith("https://")) {
    runtimeApiUrl = savedApi;
  }
}

void saveWifiConfig(const String &ssid, const String &pass, const String &apiUrl) {
  if (!wifiPrefs.begin("freshmart", false)) return;
  wifiPrefs.putString("ssid", ssid);
  wifiPrefs.putString("pass", pass);
  wifiPrefs.putString("apiUrl", apiUrl);
  wifiPrefs.end();
}

void pollSerialProvisioning() {
  while (Serial.available() > 0) {
    char ch = static_cast<char>(Serial.read());
    if (ch == '\r') continue;
    if (ch != '\n') {
      if (serialBuffer.length() < 512) serialBuffer += ch;
      continue;
    }
    String line = serialBuffer;
    serialBuffer = "";
    line.trim();
    if (line == "FM_PING") {
      printSerialStatus("FM_STATUS:");
      continue;
    }
    if (!line.startsWith("FM_WIFI_SYNC:")) continue;
    String payload = line.substring(strlen("FM_WIFI_SYNC:"));
    JsonDocument doc;
    if (deserializeJson(doc, payload) != DeserializationError::Ok) continue;
    String nextSsid = doc["ssid"] | "";
    String nextPass = doc["password"] | "";
    String nextApi = doc["apiUrl"] | "";
    String hostIp = doc["hostIp"] | "";
    nextSsid.trim();
    nextApi.trim();
    hostIp.trim();
    if (nextApi.isEmpty() && hostIp.length() > 0) {
      nextApi = "http://" + hostIp + ":4000/api/v1/iot/events";
    }
    bool wifiChanged = false;
    if (nextSsid.length() > 0 && (nextSsid != runtimeSsid || nextPass != runtimePassword)) {
      runtimeSsid = nextSsid;
      runtimePassword = nextPass;
      wifiChanged = true;
    }
    if (nextApi.startsWith("http://") || nextApi.startsWith("https://")) {
      runtimeApiUrl = nextApi;
    }
    saveWifiConfig(runtimeSsid, runtimePassword, runtimeApiUrl);
    if (wifiChanged || WiFi.status() != WL_CONNECTED || WiFi.SSID() != runtimeSsid) {
      previewAddressPrinted = false;
      lastConnect = millis();
      WiFi.disconnect(false, true);
      delay(80);
      WiFi.begin(runtimeSsid.c_str(), runtimePassword.c_str());
    }
    printSerialStatus("FM_SYNC_ACK:");
  }
}

static esp_err_t statusHandler(httpd_req_t *request) {
  JsonDocument status;
  status["ready"] = cameraReady && serviceStarted;
  status["deviceId"] = DEVICE_ID;
  status["ssid"] = WiFi.SSID();
  status["ip"] = WiFi.localIP().toString();
  status["apiUrl"] = runtimeApiUrl;
  status["decoder"] = SERVER_QR_DECODING ? "BACKEND_ZXING" : "ESP32_QUIRC";
  status["decoderFrames"] = reader.frames; status["decoded"] = reader.successfulReads;
  status["decoderMs"] = reader.lastDecodeMs; status["centerMs"] = reader.lastCenterMs; status["fullMs"] = reader.lastFullMs;
  status["postMs"] = lastPostMs; status["httpStatus"] = lastHttpStatus;
  status["freePsram"] = ESP.getFreePsram();
  String body; serializeJson(status, body);
  httpd_resp_set_type(request, "application/json"); httpd_resp_set_hdr(request, "Access-Control-Allow-Origin", "*"); httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  return httpd_resp_sendstr(request, body.c_str());
}

static uint32_t streamRequestId(httpd_req_t *request) {
  char query[80] = {}, value[24] = {};
  if (httpd_req_get_url_query_str(request, query, sizeof(query)) == ESP_OK && httpd_query_key_value(query, "sid", value, sizeof(value)) == ESP_OK) return strtoul(value, nullptr, 10);
  return 0;
}

static esp_err_t stopPreviewHandler(httpd_req_t *request) {
  uint32_t id = streamRequestId(request);
  int socket = activeStreamSocket;
  if (socket >= 0 && (!id || id == activeStreamId)) shutdown(socket, SHUT_RDWR);
  httpd_resp_set_hdr(request, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  httpd_resp_set_type(request, "application/json");
  return httpd_resp_sendstr(request, "{\"stopped\":true}");
}

void updateCameraPreview(camera_fb_t *frame) {
  uint32_t now = millis();
  if (!previewLock || !previewRequestedAt || now - previewRequestedAt > 5000 || now - lastPreviewAt < 100) return;
  lastPreviewAt = now;
  uint8_t *jpeg = nullptr; size_t length = 0;
  if (frame->format == PIXFORMAT_JPEG) {
    length = frame->len; jpeg = static_cast<uint8_t *>(malloc(length));
    if (!jpeg) return;
    memcpy(jpeg, frame->buf, length);
  } else if (!frame2jpg(frame, 65, &jpeg, &length)) return;
  if (xSemaphoreTake(previewLock, pdMS_TO_TICKS(20)) == pdTRUE) {
    free(previewJpeg); previewJpeg = jpeg; previewLength = length;
    xSemaphoreGive(previewLock);
  } else free(jpeg);
}

// Capture preview frames independently of the slower QR recognition pass.
void cameraPreviewTask(void *) {
  while (true) {
    if (previewRequestedAt && millis() - previewRequestedAt < 5000) {
      camera_fb_t *frame = esp_camera_fb_get();
      if (frame) { updateCameraPreview(frame); esp_camera_fb_return(frame); }
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

static esp_err_t streamHandler(httpd_req_t *request) {
  activeStreamSocket = httpd_req_to_sockfd(request);
  activeStreamId = streamRequestId(request);
  httpd_resp_set_type(request, "multipart/x-mixed-replace;boundary=freshmartframe");
  httpd_resp_set_hdr(request, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  while (true) {
    previewRequestedAt = millis();
    uint8_t *copy = nullptr; size_t length = 0;
    if (xSemaphoreTake(previewLock, pdMS_TO_TICKS(50)) == pdTRUE) {
      if (previewJpeg && previewLength) {
        length = previewLength; copy = static_cast<uint8_t *>(malloc(length));
        if (copy) memcpy(copy, previewJpeg, length);
      }
      xSemaphoreGive(previewLock);
    }
    if (!copy) { vTaskDelay(pdMS_TO_TICKS(100)); continue; }
    char header[100];
    int headerLength = snprintf(header, sizeof(header), "\r\n--freshmartframe\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", static_cast<unsigned>(length));
    esp_err_t result = httpd_resp_send_chunk(request, header, headerLength);
    if (result == ESP_OK) result = httpd_resp_send_chunk(request, reinterpret_cast<const char *>(copy), length);
    free(copy);
    if (result != ESP_OK) { activeStreamSocket = -1; activeStreamId = 0; return result; }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

static esp_err_t previewHandler(httpd_req_t *request) {
  previewRequestedAt = millis();
  httpd_resp_set_hdr(request, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  if (!previewLock || xSemaphoreTake(previewLock, pdMS_TO_TICKS(100)) != pdTRUE) {
    httpd_resp_set_status(request, "503 Service Unavailable"); return httpd_resp_sendstr(request, "Camera busy");
  }
  if (!previewJpeg) { xSemaphoreGive(previewLock); httpd_resp_set_status(request, "503 Service Unavailable"); return httpd_resp_sendstr(request, "Preparing preview"); }
  httpd_resp_set_type(request, "image/jpeg");
  esp_err_t result = httpd_resp_send(request, reinterpret_cast<const char *>(previewJpeg), previewLength);
  xSemaphoreGive(previewLock);
  return result;
}

bool startPreviewServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;
  config.send_wait_timeout = 2;
  config.recv_wait_timeout = 2;
  httpd_handle_t server = nullptr;
  if (httpd_start(&server, &config) != ESP_OK) { Serial.println("Camera preview server failed."); return false; }
  httpd_uri_t route = {}; route.uri = "/snapshot"; route.method = HTTP_GET; route.handler = previewHandler;
  if (httpd_register_uri_handler(server, &route) != ESP_OK) { Serial.println("Camera preview route failed."); httpd_stop(server); return false; }
  httpd_uri_t stop = {}; stop.uri = "/preview/stop"; stop.method = HTTP_GET; stop.handler = stopPreviewHandler;
  httpd_register_uri_handler(server, &stop);
  httpd_uri_t status = {}; status.uri = "/status"; status.method = HTTP_GET; status.handler = statusHandler;
  httpd_register_uri_handler(server, &status);
  // A separate HTTP server keeps the continuous stream from blocking snapshots.
  config.server_port = 81; config.ctrl_port += 1;
  httpd_handle_t streamServer = nullptr;
  if (httpd_start(&streamServer, &config) == ESP_OK) {
    httpd_uri_t stream = {}; stream.uri = "/stream"; stream.method = HTTP_GET; stream.handler = streamHandler;
    if (httpd_register_uri_handler(streamServer, &stream) != ESP_OK) httpd_stop(streamServer);
  } else Serial.println("Camera stream unavailable; snapshot is still available.");
  return true;
}

bool sendCode(const String &code) {
  time_t now = time(nullptr);
  if (now < 1700000000) { Serial.println("Waiting for UTC clock (NTP)."); return false; }
  struct tm utc; gmtime_r(&now, &utc);
  char timestamp[25]; strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%SZ", &utc);
  JsonDocument event;
  event["eventId"] = String(DEVICE_ID) + "-" + String(bootId, HEX) + "-" + String(++sequence);
  event["deviceId"] = DEVICE_ID;
  event["warehouseId"] = WAREHOUSE_ID;
  event["payload"]["resolveDemoSession"] = true;
  event["eventType"] = "CAMERA_CODE_DETECTED";
  event["tagId"] = code;
  event["timestamp"] = timestamp;
  event["payload"]["reader"] = "ESP32-CAM";
  event["payload"]["capture"] = "CAMERA";
  String body; serializeJson(event, body);
  // Retry the identical event ID and body; a repeated delivery cannot create a second receipt.
  for (int attempt = 0; attempt < 3; ++attempt) {
    HTTPClient http; http.setTimeout(5000);
    if (!http.begin(runtimeApiUrl)) return false;
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-iot-device-token", IOT_INGEST_TOKEN);
    http.addHeader("x-iot-device-ip", WiFi.localIP().toString());
    uint32_t postStarted = millis();
    int status = http.POST(body);
    lastPostMs = millis() - postStarted; lastHttpStatus = status;
    if (status == 200 || status == 202) {
      JsonDocument reply;
      if (deserializeJson(reply, http.getString()) == DeserializationError::Ok) {
        Serial.printf("Backend scan result: %s - %s\n", reply["data"]["event"]["automationStatus"] | "UNKNOWN", reply["data"]["event"]["automationMessage"] | "");
      }
    }
    http.end();
    Serial.printf("Camera event HTTP %d (%u ms): %s\n", status, lastPostMs, code.c_str());
    if (status == 200 || status == 202) return true;
    if (status >= 400 && status < 500 && status != 429) return false;
    delay(500 * (attempt + 1));
  }
  return false;
}

// The camera captures real JPEG frames; the authenticated backend decodes them.
// No browser code or selected parcel ID is accepted as a substitute for the image.
void cameraUploadTask(void *) {
  while (true) {
    vTaskDelay(pdMS_TO_TICKS(150));
    time_t now = time(nullptr);
    if (WiFi.status() != WL_CONNECTED || now < 1700000000) continue;
    String url = runtimeApiUrl;
    if (!url.endsWith("/events")) continue;
    url.remove(url.length() - 7); url += "/camera-frames";
    camera_fb_t *frame = esp_camera_fb_get();
    if (!frame) continue;
    const size_t length = frame->len;
    uint8_t *jpeg = length <= 512 * 1024 ? static_cast<uint8_t *>(ps_malloc(length)) : nullptr;
    if (jpeg) memcpy(jpeg, frame->buf, length);
    updateCameraPreview(frame);
    esp_camera_fb_return(frame);
    if (!jpeg) continue;
    struct tm utc; gmtime_r(&now, &utc);
    char timestamp[25]; strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%SZ", &utc);
    HTTPClient http; http.setConnectTimeout(1500); http.setTimeout(2000);
    if (!http.begin(url)) { free(jpeg); continue; }
    http.addHeader("Content-Type", "image/jpeg");
    http.addHeader("x-iot-device-token", IOT_INGEST_TOKEN);
    http.addHeader("x-iot-device-id", DEVICE_ID); http.addHeader("x-iot-warehouse-id", WAREHOUSE_ID);
    http.addHeader("x-iot-device-ip", WiFi.localIP().toString());
    http.addHeader("x-iot-event-id", String(DEVICE_ID) + "-" + String(bootId, HEX) + "-" + String(++sequence));
    http.addHeader("x-iot-timestamp", timestamp);
    uint32_t started = millis();
    const int status = http.POST(jpeg, length);
    free(jpeg); lastPostMs = millis() - started; lastHttpStatus = status;
    if (status == 200 || status == 202) {
      JsonDocument reply;
      if (deserializeJson(reply, http.getString()) == DeserializationError::Ok) {
        reader.frames++; reader.lastDecodeMs = reply["data"]["decodeMs"] | 0;
        if (reply["data"]["decoded"] == true) {
          reader.successfulReads++;
          String code = reply["data"]["code"].as<String>();
          if (code != lastCode || millis() - lastSend > 2500) {
            lastCode = code; lastSend = millis();
            Serial.printf("Camera QR HTTP %d; decode %u ms; frame request %u ms: %s\n", status, reader.lastDecodeMs, lastPostMs, code.c_str());
            Serial.printf("Backend scan result: %s - %s\n", reply["data"]["event"]["automationStatus"] | "UNKNOWN", reply["data"]["event"]["automationMessage"] | "");
          }
        }
      }
    } else if (millis() - lastSend > 2500) {
      lastSend = millis(); Serial.printf("Camera frame failed HTTP %d\n", status);
    }
    http.end();
    if (status <= 0 || status == 429 || status >= 500) vTaskDelay(pdMS_TO_TICKS(500));
  }
}

void setup() {
  Serial.begin(115200); Serial.setDebugOutput(true); delay(500); bootId = esp_random();
  Serial.printf("Starting camera before Wi-Fi. PSRAM: %s (%u bytes free).\n", psramFound() ? "OK" : "NOT FOUND", ESP.getFreePsram());
  QRCodeReaderSetupErr result = SETUP_CAMERA_INIT_ERROR;
  for (int attempt = 1; attempt <= 3; ++attempt) {
    result = reader.setup();
    if (result == SETUP_OK || result == SETUP_NO_PSRAM_ERROR) break;
    Serial.printf("Camera sensor communication failed; retry %d/3.\n", attempt);
    esp_camera_deinit();
    pinMode(32, OUTPUT); digitalWrite(32, HIGH); delay(150);
    digitalWrite(32, LOW); delay(250);
  }
  if (result != SETUP_OK) { Serial.printf("Camera setup failed (code %d).\n", static_cast<int>(result)); return; }
  cameraReady = true;
  previewLock = xSemaphoreCreateMutex();
  if (!previewLock) { Serial.println("Camera preview memory allocation failed."); cameraReady = false; return; }
  loadSavedWifiConfig();
  Serial.printf("Camera initialized. Connecting Wi-Fi (%s)...\n", runtimeSsid.c_str());
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true); WiFi.setSleep(false);
  lastConnect = millis();
  WiFi.begin(runtimeSsid.c_str(), runtimePassword.c_str());
}

void loop() {
  pollSerialProvisioning();
  if (!cameraReady) { delay(1000); return; }
  if (WiFi.status() != WL_CONNECTED) {
    previewAddressPrinted = false;
    if (millis() - lastConnect > 12000) {
      lastConnect = millis();
      if (!triedFallbackWifi && runtimeSsid != String(WIFI_SSID)) {
        triedFallbackWifi = true;
        runtimeSsid = WIFI_SSID;
        runtimePassword = WIFI_PASSWORD;
        Serial.printf("Switching to fallback Wi-Fi (%s)...\n", runtimeSsid.c_str());
        WiFi.disconnect(false, true);
        delay(80);
        WiFi.begin(runtimeSsid.c_str(), runtimePassword.c_str());
      } else {
        WiFi.reconnect();
        Serial.printf("Reconnecting Wi-Fi (%s)...\n", runtimeSsid.c_str());
      }
    }
    delay(100); return;
  }
  if (!previewAddressPrinted) {
    Serial.printf("Wi-Fi IP: %s\n", WiFi.localIP().toString().c_str());
    printSerialStatus("FM_STATUS:");
    previewAddressPrinted = true;
  }
  if (!serviceStarted) {
    serviceStarted = true;
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    bool previewStarted = startPreviewServer();
    if (xTaskCreatePinnedToCore(cameraPreviewTask, "cameraPreview", 4096, nullptr, 1, nullptr, 0) != pdPASS) Serial.println("Camera preview task could not start.");
    if (SERVER_QR_DECODING) {
      if (xTaskCreatePinnedToCore(cameraUploadTask, "cameraUpload", 8192, nullptr, 1, nullptr, 1) != pdPASS) Serial.println("Camera upload task could not start.");
    } else reader.beginOnCore(1);
    if (previewStarted) Serial.printf("Camera preview: http://%s/snapshot\n", WiFi.localIP().toString().c_str());
    Serial.println("Camera ready. Present the FreshMart parcel QR label.");
  }
  if (SERVER_QR_DECODING) { delay(50); return; }
  if (!cameraReady) { delay(1000); return; }
  struct QRCodeData data;
  if (!reader.receiveQrCode(&data, 100) || !data.valid) return;
  if (data.payloadLen <= 0 || data.payloadLen > 128) return;
  String code; code.reserve(data.payloadLen);
  for (int i = 0; i < data.payloadLen; ++i) code += char(data.payload[i]);
  code.trim(); code.toUpperCase();
  if (!code.startsWith("QR-") || code.length() != 39) { Serial.println("QR detected, but it is not a FreshMart parcel code."); return; }
  if (code == lastCode && millis() - lastSend < 2500) return;
  lastCode = code; lastSend = millis();
  Serial.printf("FreshMart QR detected: %s\n", code.c_str());
  sendCode(code);
}
