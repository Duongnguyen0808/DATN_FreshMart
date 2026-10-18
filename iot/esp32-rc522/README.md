# ESP32 + RC522 prototype

This is a close-range RFID reader prototype using HTTP. It does not emulate an industrial UHF gate. The truck/forklift path remains a 3D visualization; only the tag read is sent by physical hardware.

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

## Firmware setup

In Arduino IDE, select an ESP32 board and install **MFRC522** and **ArduinoJson 7**. Open `esp32-rc522.ino`, then fill in the Wi-Fi name/password, a PC-reachable backend URL, the warehouse UUID, and the same 32+ character `IOT_INGEST_TOKEN` configured in `backend/.env`. Keep those values local; do not commit them.

The ESP32 posts `RFID_DETECTED` to `/api/v1/iot/events`. It retries a failed HTTP request with the same event ID, so a network retry cannot create a second event. Serial Monitor runs at 115200 baud and prints the tag, device, and timestamp.

## Map a tag to an item

Log in as a user with `warehouses.manage`, read the tag UID from Serial Monitor, then create its mapping:

```http
POST /api/v1/iot/tag-mappings
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "tagId": "04A1B2C3D4",
  "skuId": "<sku-uuid>",
  "warehouseId": "<warehouse-uuid>",
  "palletCode": "PAL-0001"
}
```

An unmapped tag is still stored and shown as `chưa đối chiếu tag`; it cannot satisfy a PO/transfer confirmation. Mapping does not change inventory.

## Demo sequence

1. Apply the backend migration and start Backend + Web Admin on the same LAN.
2. Configure `IOT_INGEST_TOKEN`, restart Backend, and use its LAN address in the sketch.
3. Flash the ESP32, map the physical tag, and select `LIVE IOT` in the warehouse twin.
4. Start the simulated receiving/transfer route. At each RFID checkpoint, present the mapped tag. The page shows the device ID, event time, and mapped SKU from the stored event.
5. A staff member with the existing `purchase_orders.receive`, `transfers.dispatch`, or `transfers.receive` permission confirms the matching operation. Until then the event is pending and inventory is unchanged.

The Web Admin `CONNECTED` indicator means its authenticated realtime connection to Backend is online. This HTTP prototype has no reader heartbeat, so the page reports the device after its first event rather than claiming the hardware maintains a live socket connection.
