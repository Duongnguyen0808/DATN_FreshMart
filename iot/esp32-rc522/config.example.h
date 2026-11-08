#pragma once
// Copy to config.local.h and fill locally before opening the sketch.
static const char *WIFI_SSID = "YOUR_WIFI_SSID";
static const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
static const char *RFID_API_URL = "http://YOUR_PC_LAN_IP:4000/api/v1/iot/access/rfid";
static const char *DOOR_API_URL = "http://YOUR_PC_LAN_IP:4000/api/v1/iot/door/event";
static const char *HEARTBEAT_API_URL = "http://YOUR_PC_LAN_IP:4000/api/v1/iot/access/heartbeat";
static const char *IOT_INGEST_TOKEN = "SAME_TOKEN_AS_BACKEND_ENV";
static const char *DEVICE_ID = "ESP32-WH01"; // Must match registered access device code.
static const char *WAREHOUSE_ID = "YOUR_WAREHOUSE_UUID";
static const char *DOOR_ID = "DOOR-WH01-01"; // Must match registered access door code.
