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

static uint8_t activeSckPin = 18;
static uint8_t activeMisoPin = 19;
static uint8_t activeMosiPin = 23;
static uint8_t activeSsPin = 5;
static uint8_t activeRstPin = 22;
static uint8_t detectedRfidVersion = 0;
static constexpr uint8_t DOOR_REED_PIN = 27; // Reed switch to GND, internal pull-up enabled.
static constexpr uint32_t TAG_DEBOUNCE_MS = 1500;
static constexpr uint32_t DOOR_DEBOUNCE_MS = 100;
static constexpr uint8_t POST_ATTEMPTS = 3;

MFRC522 reader(5, 22);
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
uint32_t lastRfidCheckAt = 0;
String lastTagId;
int bootReedLevel = HIGH;
bool rawDoorOpen = false;
bool stableDoorOpen = false;
bool sentDoorState = false;
uint32_t rawDoorChangedAt = 0;
uint32_t lastHeartbeatAt = 0;
uint32_t autoDoorOpenAt = 0;
uint32_t autoDoorCloseAt = 0;
bool autoDoorOpened = false;

bool isValidRfidVersion(uint8_t v) {
  return v == 0x90 || v == 0x91 || v == 0x92 || v == 0x88 || v == 0x89 || v == 0xB2 || v == 0x12 || v == 0xA0;
}

void initRfidReader() {
  struct SpiBus { uint8_t sck; uint8_t miso; uint8_t mosi; };
  const SpiBus buses[] = {
    { activeSckPin, activeMisoPin, activeMosiPin },
    { 18, 19, 23 },
    { 18, 23, 19 },
    { 14, 12, 13 },
    { 14, 13, 12 },
  };
  const uint8_t ssCandidates[] = { 5, 21, 4, 15, 2, 16, 17, 25, 26 };
  const uint8_t rstCandidates[] = { 22, 21, 4, 27, 2, 15, 16, 17, 25, 26, 32, 33 };

  // First try current active pins
  SPI.end();
  pinMode(activeMisoPin, INPUT_PULLUP);
  SPI.begin(activeSckPin, activeMisoPin, activeMosiPin, activeSsPin);
  reader.PCD_Init(activeSsPin, activeRstPin);
  delay(8);
  uint8_t ver = reader.PCD_ReadRegister(MFRC522::VersionReg);
  if (isValidRfidVersion(ver)) {
    detectedRfidVersion = ver;
    reader.PCD_SetAntennaGain(reader.RxGain_max);
    reader.PCD_AntennaOn();
    return;
  }

  for (const auto &bus : buses) {
    SPI.end();
    pinMode(bus.miso, INPUT_PULLUP);
    SPI.begin(bus.sck, bus.miso, bus.mosi, activeSsPin);
    for (uint8_t ss : ssCandidates) {
      if (ss == bus.sck || ss == bus.miso || ss == bus.mosi) continue;
      for (uint8_t rst : rstCandidates) {
        if (rst == ss || rst == bus.sck || rst == bus.miso || rst == bus.mosi) continue;
        pinMode(ss, OUTPUT);
        digitalWrite(ss, HIGH);
        reader.PCD_Init(ss, rst);
        delay(4);
        uint8_t v = reader.PCD_ReadRegister(MFRC522::VersionReg);
        if (isValidRfidVersion(v)) {
          activeSckPin = bus.sck;
          activeMisoPin = bus.miso;
          activeMosiPin = bus.mosi;
          activeSsPin = ss;
          activeRstPin = rst;
          detectedRfidVersion = v;
          reader.PCD_SetAntennaGain(reader.RxGain_max);
          reader.PCD_AntennaOn();
          Serial.printf("RC522 found! ver=0x%02X SCK=%u MISO=%u MOSI=%u SS=%u RST=%u\n", v, bus.sck, bus.miso, bus.mosi, ss, rst);
          return;
        }
      }
    }
  }
  // Restore default VSPI if not found yet
  SPI.end();
  pinMode(19, INPUT_PULLUP);
  SPI.begin(18, 19, 23, 5);
  reader.PCD_Init(5, 22);
  reader.PCD_SetAntennaGain(reader.RxGain_max);
  reader.PCD_AntennaOn();
  detectedRfidVersion = reader.PCD_ReadRegister(MFRC522::VersionReg);
}

void ensureRfidReady() {
  uint8_t txCtrl = reader.PCD_ReadRegister(MFRC522::TxControlReg);
  if ((txCtrl & 0x03) != 0x03 || !isValidRfidVersion(detectedRfidVersion)) {
    initRfidReader();
  }
}

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
  if (now < 1700000000) return "2026-11-08T08:00:00Z";
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
  doc["rfidVersion"] = detectedRfidVersion;
  doc["ssPin"] = activeSsPin;
  doc["rstPin"] = activeRstPin;
  doc["lastUid"] = lastTagId;
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
      ensureRfidReady();
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
    ensureRfidReady();
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
    configTime(0, 0, "pool.ntp.org", "time.google.com");
  }
  initRfidReader();
  printSerialStatus("FM_STATUS:");
}

void setup() {
  Serial.begin(115200);
  delay(300);
  bootNonce = esp_random();
  loadSavedWifiConfig();
  pinMode(DOOR_REED_PIN, INPUT_PULLUP);
  delay(20);
  bootReedLevel = digitalRead(DOOR_REED_PIN);
  rawDoorOpen = false;
  stableDoorOpen = false;
  SPI.begin(18, 19, 23, activeSsPin); // SCK, MISO, MOSI, SS
  initRfidReader();
  connectWifi();
  Serial.println("Warehouse access ready. Present an employee card; reed switch monitors the door.");
}

void loop() {
  pollSerialProvisioning();
  if (millis() - lastRfidCheckAt >= 2000) {
    lastRfidCheckAt = millis();
    ensureRfidReady();
  }
  const bool sampledOpen = digitalRead(DOOR_REED_PIN) != bootReedLevel;
  if (sampledOpen != rawDoorOpen) { rawDoorOpen = sampledOpen; rawDoorChangedAt = millis(); }
  if (sampledOpen != stableDoorOpen && millis() - rawDoorChangedAt >= DOOR_DEBOUNCE_MS) {
    stableDoorOpen = sampledOpen;
    autoDoorOpenAt = 0;
    autoDoorCloseAt = 0;
    autoDoorOpened = false;
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
    ensureRfidReady();
  }
  if (!sentDoorState && !utcTimestamp().isEmpty()) {
    // Initial CLOSED is harmless; OPEN after reconnect is still audited by the backend.
    sentDoorState = postDoorState(stableDoorOpen);
    ensureRfidReady();
  }
  const uint32_t nowMs = millis();
  if (autoDoorOpenAt > 0 && !autoDoorOpened && nowMs >= autoDoorOpenAt && !stableDoorOpen) {
    autoDoorOpened = true;
    postDoorState(true);
    ensureRfidReady();
  }
  if (autoDoorCloseAt > 0 && autoDoorOpened && nowMs >= autoDoorCloseAt && !stableDoorOpen) {
    autoDoorOpenAt = 0;
    autoDoorCloseAt = 0;
    autoDoorOpened = false;
    postDoorState(false);
    ensureRfidReady();
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
    Serial.printf("FM_RFID_SCAN:{\"uid\":\"%s\",\"deviceId\":\"%s\",\"warehouseId\":\"%s\"}\n", tagId.c_str(), DEVICE_ID, WAREHOUSE_ID);
    if (postRfidEvent(tagId) && !stableDoorOpen) {
      autoDoorOpenAt = millis() + 3400;
      autoDoorCloseAt = millis() + 7800;
      autoDoorOpened = false;
    }
    ensureRfidReady();
  }
  reader.PICC_HaltA();
  reader.PCD_StopCrypto1();
  delay(120);
}
