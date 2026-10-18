#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>
#include <time.h>
#include <esp_system.h>

// Fill these values locally. Keep the device token out of source control.
static const char *WIFI_SSID = "YOUR_WIFI_SSID";
static const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
static const char *API_URL = "http://192.168.1.10:4000/api/v1/iot/events";
static const char *IOT_INGEST_TOKEN = "REPLACE_WITH_THE_BACKEND_IOT_INGEST_TOKEN";
static const char *DEVICE_ID = "FRESHMART-RFID-IN-01";
static const char *WAREHOUSE_ID = "REPLACE_WITH_WAREHOUSE_UUID";

static constexpr uint8_t RFID_SS_PIN = 5;
static constexpr uint8_t RFID_RST_PIN = 22;
static constexpr uint32_t TAG_DEBOUNCE_MS = 2500;
static constexpr uint8_t POST_ATTEMPTS = 3;

MFRC522 reader(RFID_SS_PIN, RFID_RST_PIN);
uint32_t eventCounter = 0;
uint32_t bootNonce = 0;
uint32_t lastReadAt = 0;
String lastTagId;

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

bool postRfidEvent(const String &tagId) {
  const String eventId = makeEventId();
  const String timestamp = utcTimestamp();
  if (timestamp.isEmpty()) {
    Serial.println("No synchronized UTC clock; RFID event was not sent.");
    return false;
  }

  JsonDocument event;
  event["eventId"] = eventId;
  event["deviceId"] = DEVICE_ID;
  event["eventType"] = "RFID_DETECTED";
  event["tagId"] = tagId;
  event["warehouseId"] = WAREHOUSE_ID;
  event["timestamp"] = timestamp;
  event["payload"]["reader"] = "RC522";
  event["payload"]["interface"] = "SPI";
  event["payload"]["firmware"] = "freshmart-esp32-rc522-v1";

  String body;
  serializeJson(event, body);
  for (uint8_t attempt = 0; attempt < POST_ATTEMPTS; ++attempt) {
    HTTPClient http;
    http.setTimeout(5000);
    if (!http.begin(API_URL)) {
      Serial.println("Could not initialize HTTP client.");
      return false;
    }
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-iot-device-token", IOT_INGEST_TOKEN);
    const int status = http.POST(body); // Reuse eventId on retries for backend idempotency.
    const String response = status > 0 ? http.getString() : http.errorToString(status);
    http.end();

    if (status == 200 || status == 202) {
      Serial.printf("RFID event accepted (%d): device=%s tag=%s time=%s\n", status, DEVICE_ID, tagId.c_str(), timestamp.c_str());
      return true;
    }
    Serial.printf("RFID event POST attempt %u failed (%d): %s\n", attempt + 1, status, response.c_str());
    delay(500U << attempt);
  }
  return false;
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(400);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected; ESP32 address: ");
    Serial.println(WiFi.localIP());
    configTime(0, 0, "pool.ntp.org", "time.google.com");
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  bootNonce = esp_random();
  SPI.begin(18, 19, 23, RFID_SS_PIN); // SCK, MISO, MOSI, SS
  reader.PCD_Init();
  connectWifi();
  const uint32_t start = millis();
  while (WiFi.status() == WL_CONNECTED && utcTimestamp().isEmpty() && millis() - start < 12000) delay(250);
  Serial.println("RC522 ready. Present a mapped tag close to the reader.");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
    delay(1000);
    return;
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
