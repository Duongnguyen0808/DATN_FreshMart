#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "src/qr-reader/ESP32QRCodeReader.h"
#include <time.h>
#include <esp_system.h>
#include <esp_wifi.h>
#include <esp_http_server.h>
#include <img_converters.h>
#include <lwip/sockets.h>
#include "config.local.h"

#ifndef SERVER_QR_DECODING
#define SERVER_QR_DECODING 1
#endif

// SVGA (800x600) preserves sharp 1D barcode bars and crisp QR modules while keeping smooth PSRAM streaming.
ESP32QRCodeReader reader(CAMERA_MODEL_AI_THINKER, FRAMESIZE_SVGA);
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
volatile uint32_t previewFrameSeq = 0;
volatile uint32_t previewRequestedAt = 0;
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

void applyWifiSyncPayload(const String &payload, bool overHttp = false) {
  JsonDocument doc;
  if (deserializeJson(doc, payload) != DeserializationError::Ok) return;
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
  if (nextSsid.length() > 0 && (nextSsid != runtimeSsid || (nextPass.length() > 0 && nextPass != runtimePassword))) {
    runtimeSsid = nextSsid;
    runtimePassword = nextPass;
    wifiChanged = true;
  }
  if (nextApi.startsWith("http://") || nextApi.startsWith("https://")) {
    runtimeApiUrl = nextApi;
  }
  saveWifiConfig(runtimeSsid, runtimePassword, runtimeApiUrl);
  if (!overHttp && (wifiChanged || WiFi.status() != WL_CONNECTED || WiFi.SSID() != runtimeSsid)) {
    previewAddressPrinted = false;
    lastConnect = millis();
    WiFi.disconnect(false, true);
    delay(40);
    WiFi.begin(runtimeSsid.c_str(), runtimePassword.c_str());
  }
  printSerialStatus("FM_SYNC_ACK:");
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
    applyWifiSyncPayload(line.substring(strlen("FM_WIFI_SYNC:")), false);
  }
}

static esp_err_t statusHandler(httpd_req_t *request) {
  char query[192] = {}, hostIpVal[64] = {};
  if (httpd_req_get_url_query_str(request, query, sizeof(query)) == ESP_OK) {
    if (httpd_query_key_value(query, "hostIp", hostIpVal, sizeof(hostIpVal)) == ESP_OK && strlen(hostIpVal) > 6) {
      String nextApi = "http://" + String(hostIpVal) + ":4000/api/v1/iot/events";
      if (nextApi != runtimeApiUrl) {
        runtimeApiUrl = nextApi;
        saveWifiConfig(runtimeSsid, runtimePassword, runtimeApiUrl);
      }
    }
  }
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
  httpd_resp_set_type(request, "application/json");
  httpd_resp_set_hdr(request, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
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

// Single high-rate producer task for the camera sensor (avoids DMA mutex contention).
void cameraCaptureTask(void *) {
  while (true) {
    camera_fb_t *frame = esp_camera_fb_get();
    if (!frame) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }
    if (frame->format == PIXFORMAT_JPEG && frame->len > 0 && frame->len <= 256 * 1024) {
      if (xSemaphoreTake(previewLock, pdMS_TO_TICKS(15)) == pdTRUE) {
        uint8_t *buf = static_cast<uint8_t *>(ps_malloc(frame->len));
        if (buf) {
          memcpy(buf, frame->buf, frame->len);
          free(previewJpeg);
          previewJpeg = buf;
          previewLength = frame->len;
          previewFrameSeq++;
        }
        xSemaphoreGive(previewLock);
      }
    }
    esp_camera_fb_return(frame);
    vTaskDelay(pdMS_TO_TICKS(15)); // ~30 FPS sensor capture rate
  }
}

static esp_err_t streamHandler(httpd_req_t *request) {
  int sockfd = httpd_req_to_sockfd(request);
  activeStreamSocket = sockfd;
  activeStreamId = streamRequestId(request);
  int nodelay = 1;
  setsockopt(sockfd, IPPROTO_TCP, TCP_NODELAY, &nodelay, sizeof(nodelay));
  httpd_resp_set_type(request, "multipart/x-mixed-replace;boundary=freshmartframe");
  httpd_resp_set_hdr(request, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  uint32_t lastSentSeq = 0;
  while (true) {
    previewRequestedAt = millis();
    if (previewFrameSeq == lastSentSeq) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }
    uint8_t *copy = nullptr;
    size_t length = 0;
    uint32_t seqNow = 0;
    if (xSemaphoreTake(previewLock, pdMS_TO_TICKS(25)) == pdTRUE) {
      if (previewJpeg && previewLength) {
        length = previewLength;
        seqNow = previewFrameSeq;
        copy = static_cast<uint8_t *>(ps_malloc(length));
        if (copy) memcpy(copy, previewJpeg, length);
      }
      xSemaphoreGive(previewLock);
    }
    if (!copy) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }
    lastSentSeq = seqNow;
    char header[100];
    int headerLength = snprintf(header, sizeof(header), "\r\n--freshmartframe\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", static_cast<unsigned>(length));
    esp_err_t result = httpd_resp_send_chunk(request, header, headerLength);
    if (result == ESP_OK) result = httpd_resp_send_chunk(request, reinterpret_cast<const char *>(copy), length);
    free(copy);
    if (result != ESP_OK) {
      activeStreamSocket = -1;
      activeStreamId = 0;
      return result;
    }
    vTaskDelay(pdMS_TO_TICKS(18)); // Smooth ~25 FPS output without starving Core 0
  }
}

static esp_err_t previewHandler(httpd_req_t *request) {
  previewRequestedAt = millis();
  httpd_resp_set_hdr(request, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  if (!previewLock || xSemaphoreTake(previewLock, pdMS_TO_TICKS(60)) != pdTRUE) {
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
  config.lru_purge_enable = true;
  httpd_handle_t server = nullptr;
  if (httpd_start(&server, &config) != ESP_OK) { Serial.println("Camera preview server failed."); return false; }
  httpd_uri_t route = {}; route.uri = "/snapshot"; route.method = HTTP_GET; route.handler = previewHandler;
  if (httpd_register_uri_handler(server, &route) != ESP_OK) { Serial.println("Camera preview route failed."); httpd_stop(server); return false; }
  httpd_uri_t stop = {}; stop.uri = "/preview/stop"; stop.method = HTTP_GET; stop.handler = stopPreviewHandler;
  httpd_register_uri_handler(server, &stop);
  httpd_uri_t status = {}; status.uri = "/status"; status.method = HTTP_GET; status.handler = statusHandler;
  httpd_register_uri_handler(server, &status);
  // Separate HTTP server on port 81 keeps MJPEG stream independent.
  config.server_port = 81; config.ctrl_port += 1;
  httpd_handle_t streamServer = nullptr;
  if (httpd_start(&streamServer, &config) == ESP_OK) {
    httpd_uri_t stream = {}; stream.uri = "/stream"; stream.method = HTTP_GET; stream.handler = streamHandler;
    if (httpd_register_uri_handler(streamServer, &stream) != ESP_OK) httpd_stop(streamServer);
  } else Serial.println("Camera stream unavailable; snapshot is still available.");
  return true;
}

String currentIsoTimestamp() {
  time_t now = time(nullptr);
  if (now < 1700000000) return "2026-11-09T08:00:00Z";
  struct tm utc;
  gmtime_r(&now, &utc);
  char timestamp[25];
  strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%SZ", &utc);
  return String(timestamp);
}

bool sendCode(const String &code) {
  String timestamp = currentIsoTimestamp();
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
  for (int attempt = 0; attempt < 3; ++attempt) {
    HTTPClient http; http.setTimeout(3000);
    if (!http.begin(runtimeApiUrl)) return false;
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-iot-device-token", IOT_INGEST_TOKEN);
    http.addHeader("x-iot-device-ip", WiFi.localIP().toString());
    uint32_t postStarted = millis();
    int status = http.POST(body);
    lastPostMs = millis() - postStarted; lastHttpStatus = status;
    http.end();
    if (status == 200 || status == 202) return true;
    if (status >= 400 && status < 500 && status != 429) return false;
    delay(250 * (attempt + 1));
  }
  return false;
}

// Persistent Keep-Alive uploader reads from shared PSRAM buffer (zero camera sensor lock contention).
void cameraUploadTask(void *) {
  WiFiClient uploadClient;
  HTTPClient http;
  http.setReuse(true);
  String activeUrl = "";
  uint32_t lastUploadedSeq = 0;

  while (true) {
    vTaskDelay(pdMS_TO_TICKS(32)); // ~25 FPS continuous push to backend
    if (WiFi.status() != WL_CONNECTED) {
      vTaskDelay(pdMS_TO_TICKS(200));
      continue;
    }
    if (previewFrameSeq == lastUploadedSeq) continue;

    String url = runtimeApiUrl;
    if (!url.endsWith("/events")) continue;
    url.remove(url.length() - 7);
    url += "/camera-frames";

    uint8_t *jpeg = nullptr;
    size_t length = 0;
    uint32_t seqNow = 0;
    if (xSemaphoreTake(previewLock, pdMS_TO_TICKS(20)) == pdTRUE) {
      if (previewJpeg && previewLength > 0 && previewLength <= 256 * 1024) {
        length = previewLength;
        seqNow = previewFrameSeq;
        jpeg = static_cast<uint8_t *>(ps_malloc(length));
        if (jpeg) memcpy(jpeg, previewJpeg, length);
      }
      xSemaphoreGive(previewLock);
    }
    if (!jpeg) continue;
    lastUploadedSeq = seqNow;

    String timestamp = currentIsoTimestamp();
    uploadClient.setNoDelay(true);
    http.setConnectTimeout(900);
    http.setTimeout(1200);
    if (url != activeUrl) {
      http.end();
      if (!http.begin(uploadClient, url)) {
        free(jpeg);
        continue;
      }
      activeUrl = url;
    }
    http.addHeader("Content-Type", "image/jpeg");
    http.addHeader("Connection", "keep-alive");
    http.addHeader("x-iot-device-token", IOT_INGEST_TOKEN);
    http.addHeader("x-iot-device-id", DEVICE_ID);
    http.addHeader("x-iot-warehouse-id", WAREHOUSE_ID);
    http.addHeader("x-iot-device-ip", WiFi.localIP().toString());
    http.addHeader("x-iot-event-id", String(DEVICE_ID) + "-" + String(bootId, HEX) + "-" + String(++sequence));
    http.addHeader("x-iot-timestamp", timestamp);

    uint32_t started = millis();
    const int status = http.POST(jpeg, length);
    free(jpeg);
    lastPostMs = millis() - started;
    lastHttpStatus = status;

    if (status == 200 || status == 202) {
      JsonDocument reply;
      if (deserializeJson(reply, http.getString()) == DeserializationError::Ok) {
        reader.frames++;
        reader.lastDecodeMs = reply["data"]["decodeMs"] | 0;
        if (reply["data"]["decoded"] == true) {
          reader.successfulReads++;
          String code = reply["data"]["code"].as<String>();
          if (code != lastCode || millis() - lastSend > 2000) {
            lastCode = code;
            lastSend = millis();
            Serial.printf("Camera QR HTTP %d; decode %u ms; frame request %u ms: %s\n", status, reader.lastDecodeMs, lastPostMs, code.c_str());
          }
        }
      }
    } else {
      http.end();
      activeUrl = "";
      vTaskDelay(pdMS_TO_TICKS(350));
    }
  }
}

void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(false);
  delay(30);
  bootId = esp_random();
  loadSavedWifiConfig();
  Serial.println("FM_BOOT_READY");
  printSerialStatus("FM_STATUS:");
  pollSerialProvisioning();

  QRCodeReaderSetupErr result = SETUP_CAMERA_INIT_ERROR;
  for (int attempt = 1; attempt <= 3; ++attempt) {
    result = reader.setup();
    if (result == SETUP_OK || result == SETUP_NO_PSRAM_ERROR) break;
    esp_camera_deinit();
    pinMode(32, OUTPUT); digitalWrite(32, HIGH); delay(100);
    digitalWrite(32, LOW); delay(150);
  }
  if (result != SETUP_OK) { Serial.printf("Camera setup failed (code %d).\n", static_cast<int>(result)); return; }
  cameraReady = true;
  previewLock = xSemaphoreCreateMutex();
  if (!previewLock) { cameraReady = false; return; }

  pollSerialProvisioning();
  Serial.printf("Camera initialized. Connecting Wi-Fi (%s)...\n", runtimeSsid.c_str());
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  esp_wifi_set_ps(WIFI_PS_NONE);
  lastConnect = millis();
  WiFi.begin(runtimeSsid.c_str(), runtimePassword.c_str());
}

void loop() {
  pollSerialProvisioning();
  if (!cameraReady) { delay(500); return; }
  if (WiFi.status() != WL_CONNECTED) {
    previewAddressPrinted = false;
    if (millis() - lastConnect > 9000) {
      lastConnect = millis();
      if (!triedFallbackWifi && runtimeSsid != String(WIFI_SSID)) {
        triedFallbackWifi = true;
        runtimeSsid = WIFI_SSID;
        runtimePassword = WIFI_PASSWORD;
        WiFi.disconnect(false, true);
        delay(40);
        WiFi.begin(runtimeSsid.c_str(), runtimePassword.c_str());
      } else {
        WiFi.reconnect();
      }
    }
    delay(40);
    return;
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
    if (xTaskCreatePinnedToCore(cameraCaptureTask, "cameraCapture", 4096, nullptr, 2, nullptr, 0) != pdPASS) {
      Serial.println("Camera capture task could not start.");
    }
    if (SERVER_QR_DECODING) {
      if (xTaskCreatePinnedToCore(cameraUploadTask, "cameraUpload", 8192, nullptr, 1, nullptr, 1) != pdPASS) {
        Serial.println("Camera upload task could not start.");
      }
    } else {
      reader.beginOnCore(1);
    }
    if (previewStarted) Serial.printf("Camera preview: http://%s/snapshot\n", WiFi.localIP().toString().c_str());
  }
  if (SERVER_QR_DECODING) { delay(30); return; }
  struct QRCodeData data;
  if (!reader.receiveQrCode(&data, 50) || !data.valid) return;
  if (data.payloadLen <= 0 || data.payloadLen > 128) return;
  String code; code.reserve(data.payloadLen);
  for (int i = 0; i < data.payloadLen; ++i) code += char(data.payload[i]);
  code.trim(); code.toUpperCase();
  if (!code.startsWith("QR-") || code.length() != 39) return;
  if (code == lastCode && millis() - lastSend < 2000) return;
  lastCode = code; lastSend = millis();
  sendCode(code);
}
