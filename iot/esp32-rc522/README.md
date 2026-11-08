# ESP32 + RC522 + reed switch: warehouse access

This sketch reads **employee cards and the physical warehouse door**. Product receiving remains on the QR/ESP32-CAM workflow. RC522 is a short-range 13.56 MHz reader, not an industrial UHF gate or a physical door lock.

## Wiring

Use an ESP32 DevKit and RC522 module. Power the reader from **3.3 V**, share ground, and wire SPI as follows:

| RC522 | ESP32 |
| --- | --- |
| SDA / SS | GPIO 5 |
| SCK | GPIO 18 |
| MOSI | GPIO 23 |
| MISO | GPIO 19 |
| RST | GPIO 22 |
| 3.3 V | 3V3 |
| GND | GND |

Do not power the RC522 from 5 V. Use a 13.56 MHz tag compatible with the chosen reader.

Connect one reed-switch wire to GPIO 27 and the other to GND. The sketch uses `INPUT_PULLUP`: the magnet near a normally-open switch means `CLOSED`; moving it away reads `OPEN`. If your switch is normally closed, invert the GPIO comparison in the sketch.

## Firmware setup

In Arduino IDE, select an ESP32 board and install **MFRC522** and **ArduinoJson 7**. Open `esp32-rc522.ino`, then keep `config.local.h` beside the sketch. This local file defines the Wi-Fi name/password, a PC-reachable backend URL, the warehouse UUID, and the same 32+ character `IOT_INGEST_TOKEN` configured in `backend/.env`. Restart Backend after changing its environment. The header is ignored by Git; copy `config.example.h` to `config.local.h` on another machine and fill it locally. Keep those values local; do not commit them.

Set the device code and door code in `config.local.h` to match the records in **Quản lý kho → Giám sát cửa kho**. Register the device, door, and an active card for a branch employee before testing. The ESP32 posts to `/api/v1/iot/access/rfid` and `/api/v1/iot/door/event`, and heartbeats to `/api/v1/iot/access/heartbeat` every 25 seconds so the backend can show whether it is online. It retries each physical event with the same event ID. Serial Monitor runs at 115200 baud.

## Backend rules and demo

Backend defaults: `ACCESS_WINDOW_SECONDS=10`, `MAX_DOOR_OPEN_SECONDS=30`, warehouse hours 07:00–22:00 in Asia/Ho_Chi_Minh. One valid card scan authorizes one opening within the access window. Opening without a grant, opening outside hours, and leaving the door open too long create alerts. Closing resolves the long-open alert; other security alerts require acknowledgment. Neither access event nor simulation changes stock.

The sketch debounces card reads (2.5 s) and the reed switch (100 ms). Backend rejects duplicate event IDs, repeated scans and unchanged door states. If Wi-Fi fails, the sketch sends the current stable door state on reconnect; it does not persist a full offline event queue. Use reliable Wi-Fi during the demo. Simulation uses the same backend rules when no real device has checked in for 60 seconds.
