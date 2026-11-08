#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <SPI.h>
#include <MFRC522.h>
#include <time.h>
#include <esp_system.h>

#include "config.local.h"

static constexpr uint8_t RFID_SS_PIN = 5;
static constexpr uint8_t RFID_RST_PIN = 22;
static constexpr uint8_t DOOR_REED_PIN = 27; // Reed switch to GND, internal pull-up enabled.
static constexpr uint32_t TAG_DEBOUNCE_MS = 2500;
static constexpr uint32_t DOOR_DEBOUNCE_MS = 100;
static constexpr uint8_t POST_ATTEMPTS = 3;

MFRC522 reader(RFID_SS_PIN, RFID_RST_PIN);
Preferences wifiPrefs;
String runtimeSsid = WIFI_SSID;
String runtimePassword = WIFI_PASSWORD;
String runtimeRfidUrl = RFID_API_URL;
String runtimeDoorUrl = DOOR_API_URL;
String runtimeHeartbeatUrl = HEARTBEAT_API_URL;
String serialBuffer;
uint32_t eventCounter = 0;
uint32_t bootNonce = 0;
uint32_t lastReadAt = 0;
String lastTagId;
bool rawDoorOpen = false;
bool stableDoorOpen = false;
bool sentDoorState = false;
uint32_t rawDoorChangedAt = 0;
uint32_t lastHeartbeatAt = 0;

String tagToHex(const MFRC522::Uid &uid) {
  String result;
  result.reserve(uid.size * 2);
  for (byte i = 0; i < uid.size; ++i) {
    if (uid.uidByte[i] < 0x10) result += '0';
    result += String(uid.uidByte[i], HEX);
  }
  result.toUpperCase();
  return result;
}

String makeEventId() {
  return String(DEVICE_ID) + "-" + String(bootNonce, HEX) + "-" + String(++eventCounter, HEX);
}

String utcTimestamp() {
  time_t now = time(nullptr);
  if (now < 1700000000) return "";
  struct tm utc;
  gmtime_r(&now, &utc);
  char formatted[25];
  strftime(formatted, sizeof(formatted), "%Y-%m-%dT%H:%M:%SZ", &utc);
  return String(formatted);
}

bool postEvent(const char *url, JsonDocument &event) {
  const String timestamp = utcTimestamp();
  if (timestamp.isEmpty()) {
    Serial.println("No synchronized UTC clock; physical event was not sent.");
    return false;
  }
  event["eventId"] = makeEventId();
  event["deviceId"] = DEVICE_ID;
  event["warehouseId"] = WAREHOUSE_ID;
  event["timestamp"] = timestamp;

  String body;
  serializeJson(event, body);
  for (uint8_t attempt = 0; attempt < POST_ATTEMPTS; ++attempt) {
    HTTPClient http;
    http.setTimeout(5000);
    if (!http.begin(url)) {
      Serial.println("Could not initialize HTTP client.");
      return false;
    }
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-iot-device-token", IOT_INGEST_TOKEN);
    const int status = http.POST(body); // Reuse eventId on retries for backend idempotency.
    const String response = status > 0 ? http.getString() : http.errorToString(status);
    http.end();

    if (status == 200 || status == 202) {
      Serial.printf("Physical event accepted (%d): device=%s time=%s\n", status, DEVICE_ID, timestamp.c_str());
      return true;
    }
    Serial.printf("RFID event POST attempt %u failed (%d): %s\n", attempt + 1, status, response.c_str());
    delay(500U << attempt);
  }
  return false;
}

bool postRfidEvent(const String &uid) {
  JsonDocument event;
  event["uid"] = uid;
  return postEvent(runtimeRfidUrl.c_str(), event);
}

bool postDoorState(bool open) {
  JsonDocument event;
  event["doorId"] = DOOR_ID;
  event["state"] = open ? "OPEN" : "CLOSED";
  return postEvent(runtimeDoorUrl.c_str(), event);
}

bool postHeartbeat() {
  JsonDocument event;
  event["deviceId"] = DEVICE_ID;
  event["warehouseId"] = WAREHOUSE_ID;
  String body;
  serializeJson(event, body);
  HTTPClient http;
  http.setTimeout(5000);
  if (!http.begin(runtimeHeartbeatUrl)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-iot-device-token", IOT_INGEST_TOKEN);
  http.addHeader("x-iot-device-ip", WiFi.localIP().toString());
  const int status = http.POST(body);
  http.end();
  return status == 200;
}

void applyHostIp(const String &hostIp) {
  if (hostIp.isEmpty()) return;
  runtimeRfidUrl = "http://" + hostIp + ":4000/api/v1/iot/access/rfid";
  runtimeDoorUrl = "http://" + hostIp + ":4000/api/v1/iot/door/event";
  runtimeHeartbeatUrl = "http://" + hostIp + ":4000/api/v1/iot/access/heartbeat";
}

void loadSavedWifiConfig() {
  if (!wifiPrefs.begin("freshmart", true)) return;
  String savedSsid = wifiPrefs.getString("ssid", "");
  String savedPass = wifiPrefs.getString("pass", "");
  String savedHost = wifiPrefs.getString("hostIp", "");
  wifiPrefs.end();
  if (savedSsid.length() > 0) {
    runtimeSsid = savedSsid;
    runtimePassword = savedPass;
  }
  applyHostIp(savedHost);
}

void saveWifiConfig(const String &ssid, const String &pass, const String &hostIp) {
  if (!wifiPrefs.begin("freshmart", false)) return;
  wifiPrefs.putString("ssid", ssid);
  wifiPrefs.putString("pass", pass);
  if (hostIp.length() > 0) wifiPrefs.putString("hostIp", hostIp);
  wifiPrefs.end();
}

void printSerialStatus(const char *prefix = "FM_STATUS:") {
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;
  doc["warehouseId"] = WAREHOUSE_ID;
  doc["ssid"] = WiFi.status() == WL_CONNECTED ? WiFi.SSID() : runtimeSsid;
  doc["ip"] = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "";
  doc["connected"] = WiFi.status() == WL_CONNECTED;
  String out;
  serializeJson(doc, out);
  Serial.printf("%s%s\n", prefix, out.c_str());
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
    String hostIp = doc["hostIp"] | "";
    nextSsid.trim();
    hostIp.trim();
    bool wifiChanged = false;
    if (nextSsid.length() > 0 && (nextSsid != runtimeSsid || nextPass != runtimePassword)) {
      runtimeSsid = nextSsid;
      runtimePassword = nextPass;
      wifiChanged = true;
    }
    applyHostIp(hostIp);
    saveWifiConfig(runtimeSsid, runtimePassword, hostIp);
    if (wifiChanged || WiFi.status() != WL_CONNECTED || WiFi.SSID() != runtimeSsid) {
      WiFi.disconnect(false, true);
      delay(80);
      WiFi.begin(runtimeSsid.c_str(), runtimePassword.c_str());
    }
    printSerialStatus("FM_SYNC_ACK:");
  }
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(runtimeSsid.c_str(), runtimePassword.c_str());
  Serial.printf("Connecting to Wi-Fi (%s)", runtimeSsid.c_str());
  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 14000) {
    pollSerialProvisioning();
    delay(250);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected; ESP32 address: ");
    Serial.println(WiFi.localIP());
    printSerialStatus("FM_STATUS:");
    configTime(0, 0, "pool.ntp.org", "time.google.com");
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  bootNonce = esp_random();
  loadSavedWifiConfig();
  pinMode(DOOR_REED_PIN, INPUT_PULLUP);
  rawDoorOpen = digitalRead(DOOR_REED_PIN) == HIGH;
  stableDoorOpen = rawDoorOpen;
  SPI.begin(18, 19, 23, RFID_SS_PIN); // SCK, MISO, MOSI, SS
  reader.PCD_Init();
  connectWifi();
  const uint32_t start = millis();
  while (WiFi.status() == WL_CONNECTED && utcTimestamp().isEmpty() && millis() - start < 12000) {
    pollSerialProvisioning();
    delay(250);
  }
  Serial.println("Warehouse access ready. Present an employee card; reed switch monitors the door.");
}

void loop() {
  pollSerialProvisioning();
  const bool sampledOpen = digitalRead(DOOR_REED_PIN) == HIGH;
  if (sampledOpen != rawDoorOpen) { rawDoorOpen = sampledOpen; rawDoorChangedAt = millis(); }
  if (sampledOpen != stableDoorOpen && millis() - rawDoorChangedAt >= DOOR_DEBOUNCE_MS) {
    stableDoorOpen = sampledOpen;
    sentDoorState = false;
  }
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
    delay(1000);
    return;
  }
  if (lastHeartbeatAt == 0 || millis() - lastHeartbeatAt >= 25000) {
    if (!postHeartbeat()) Serial.println("Warehouse access heartbeat failed; retrying later.");
    lastHeartbeatAt = millis();
  }
  if (!sentDoorState && !utcTimestamp().isEmpty()) {
    // Initial CLOSED is harmless; OPEN after reconnect is still audited by the backend.
    sentDoorState = postDoorState(stableDoorOpen);
  }
  if (!reader.PICC_IsNewCardPresent() || !reader.PICC_ReadCardSerial()) {
    delay(20);
    return;
  }

  const String tagId = tagToHex(reader.uid);
  const uint32_t now = millis();
  if (tagId != lastTagId || now - lastReadAt >= TAG_DEBOUNCE_MS) {
    lastTagId = tagId;
    lastReadAt = now;
    Serial.printf("Tag detected: %s\n", tagId.c_str());
    postRfidEvent(tagId);
  }
  reader.PICC_HaltA();
  reader.PCD_StopCrypto1();
  delay(120);
}
