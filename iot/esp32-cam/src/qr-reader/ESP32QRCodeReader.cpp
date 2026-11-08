#include "ESP32QRCodeReader.h"

#include "quirc/quirc.h"
#include "Arduino.h"
#include "img_converters.h"

ESP32QRCodeReader::ESP32QRCodeReader() : ESP32QRCodeReader(CAMERA_MODEL_AI_THINKER, FRAMESIZE_QVGA)
{
}

ESP32QRCodeReader::ESP32QRCodeReader(framesize_t frameSize) : ESP32QRCodeReader(CAMERA_MODEL_AI_THINKER, frameSize)
{
}

ESP32QRCodeReader::ESP32QRCodeReader(CameraPins pins) : ESP32QRCodeReader(pins, FRAMESIZE_QVGA)
{
}

ESP32QRCodeReader::ESP32QRCodeReader(CameraPins pins, framesize_t frameSize) : pins(pins), frameSize(frameSize)
{
  qrCodeQueue = xQueueCreate(10, sizeof(struct QRCodeData));
}

ESP32QRCodeReader::~ESP32QRCodeReader()
{
  end();
}

QRCodeReaderSetupErr ESP32QRCodeReader::setup()
{
  if (!psramFound())
  {
    Serial.println("Camera init: PSRAM not detected. Check board/PSRAM settings.");
    return SETUP_NO_PSRAM_ERROR;
  }

  cameraConfig.ledc_channel = LEDC_CHANNEL_0;
  cameraConfig.ledc_timer = LEDC_TIMER_0;
  cameraConfig.pin_d0 = pins.Y2_GPIO_NUM;
  cameraConfig.pin_d1 = pins.Y3_GPIO_NUM;
  cameraConfig.pin_d2 = pins.Y4_GPIO_NUM;
  cameraConfig.pin_d3 = pins.Y5_GPIO_NUM;
  cameraConfig.pin_d4 = pins.Y6_GPIO_NUM;
  cameraConfig.pin_d5 = pins.Y7_GPIO_NUM;
  cameraConfig.pin_d6 = pins.Y8_GPIO_NUM;
  cameraConfig.pin_d7 = pins.Y9_GPIO_NUM;
  cameraConfig.pin_xclk = pins.XCLK_GPIO_NUM;
  cameraConfig.pin_pclk = pins.PCLK_GPIO_NUM;
  cameraConfig.pin_vsync = pins.VSYNC_GPIO_NUM;
  cameraConfig.pin_href = pins.HREF_GPIO_NUM;
  cameraConfig.pin_sscb_sda = pins.SIOD_GPIO_NUM;
  cameraConfig.pin_sscb_scl = pins.SIOC_GPIO_NUM;
  cameraConfig.pin_pwdn = pins.PWDN_GPIO_NUM;
  cameraConfig.pin_reset = pins.RESET_GPIO_NUM;
  cameraConfig.xclk_freq_hz = 20000000;
  cameraConfig.pixel_format = PIXFORMAT_JPEG;

  //cameraConfig.frame_size = FRAMESIZE_VGA;
  // Match the CameraWebServer initialization confirmed on the OV3660.
  cameraConfig.frame_size = FRAMESIZE_UXGA;
  cameraConfig.jpeg_quality = 10;
  cameraConfig.fb_count = 2;
  cameraConfig.fb_location = CAMERA_FB_IN_PSRAM;
  cameraConfig.grab_mode = CAMERA_GRAB_LATEST;

#if defined(CAMERA_MODEL_ESP_EYE)
  pinMode(13, INPUT_PULLUP);
  pinMode(14, INPUT_PULLUP);
#endif

  // camera init
  Serial.println("Camera init: calling esp_camera_init (AI Thinker, JPEG)...");
  esp_err_t err = esp_camera_init(&cameraConfig);
  if (err != ESP_OK)
  {
    Serial.printf("Camera init: esp_camera_init failed: 0x%x (%s)\n", err, esp_err_to_name(err));
    return SETUP_CAMERA_INIT_ERROR;
  }
  sensor_t *sensor = esp_camera_sensor_get();
  if (!sensor) { Serial.println("Camera init: sensor unavailable."); esp_camera_deinit(); return SETUP_CAMERA_INIT_ERROR; }
  if (sensor->id.PID == OV3660_PID) { sensor->set_vflip(sensor, 1); sensor->set_brightness(sensor, 1); sensor->set_saturation(sensor, -2); }
  if (sensor->set_framesize(sensor, frameSize) != 0) { Serial.println("Camera init: frame size could not be set."); esp_camera_deinit(); return SETUP_CAMERA_INIT_ERROR; }
  cameraConfig.frame_size = frameSize;
  Serial.println("Camera init: sensor initialized successfully.");
  return SETUP_OK;
}

void dumpData(const struct quirc_data *data)
{
  Serial.printf("Version: %d\n", data->version);
  Serial.printf("ECC level: %c\n", "MLHQ"[data->ecc_level]);
  Serial.printf("Mask: %d\n", data->mask);
  Serial.printf("Length: %d\n", data->payload_len);
  Serial.printf("Payload: %s\n", data->payload);
}

// Read the center at original resolution; no downsampling of QR modules.
static bool recognizeFrame(ESP32QRCodeReader *self, struct quirc *q, const uint8_t *rgb,
                           int frameWidth, int x, int y, int width, int height) {
  uint8_t *gray = quirc_begin(q, nullptr, nullptr);
  for (int row = 0; row < height; ++row) {
    const uint8_t *source = rgb + ((y + row) * frameWidth + x) * 3;
    uint8_t *dest = gray + row * width;
    for (int col = 0; col < width; ++col, source += 3)
      dest[col] = static_cast<uint8_t>((77 * source[0] + 150 * source[1] + 29 * source[2]) >> 8);
  }
  quirc_end(q);
  for (int i = 0; i < quirc_count(q); ++i) {
    struct quirc_code code;
    struct quirc_data data;
    quirc_extract(q, i, &code);
    quirc_decode_error_t error = quirc_decode(&code, &data);
    if (error) { quirc_flip(&code); error = quirc_decode(&code, &data); }
    if (error || data.payload_len < 1 || data.payload_len >= 1024) continue;
    struct QRCodeData result = {};
    result.valid = true; result.dataType = data.data_type; result.payloadLen = data.payload_len;
    memcpy(result.payload, data.payload, data.payload_len);
    result.payload[data.payload_len] = 0;
    if (xQueueSend(self->qrCodeQueue, &result, 0) == pdTRUE) self->successfulReads++;
    return true;
  }
  return false;
}

void qrCodeDetectTask(void *taskData) {
  ESP32QRCodeReader *self = static_cast<ESP32QRCodeReader *>(taskData);
  struct quirc *full = quirc_new(), *center = quirc_new();
  uint8_t *rgb = nullptr;
  int oldWidth = 0, oldHeight = 0, centerWidth = 0, centerHeight = 0;
  uint32_t passes = 0;
  if (!full) { if (center) quirc_destroy(center); Serial.println("QR reader: no decoder memory."); vTaskDelete(nullptr); return; }
  while (true) {
    vTaskDelay(pdMS_TO_TICKS(10));
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) continue;
    const uint32_t started = millis();
    if (fb->width != oldWidth || fb->height != oldHeight) {
      if (quirc_resize(full, fb->width, fb->height) < 0) { esp_camera_fb_return(fb); continue; }
      free(rgb); rgb = static_cast<uint8_t *>(ps_malloc(static_cast<size_t>(fb->width) * fb->height * 3));
      if (!rgb) { oldWidth = 0; esp_camera_fb_return(fb); vTaskDelay(pdMS_TO_TICKS(1000)); continue; }
      oldWidth = fb->width; oldHeight = fb->height;
      centerWidth = oldWidth < 384 ? oldWidth : 384;
      centerHeight = oldHeight < 384 ? oldHeight : 384;
      if (center && quirc_resize(center, centerWidth, centerHeight) < 0) {
        quirc_destroy(center); center = nullptr; Serial.println("QR reader: using full-frame fallback (low PSRAM).");
      }
    }
    const bool converted = fmt2rgb888(fb->buf, fb->len, fb->format, rgb);
    esp_camera_fb_return(fb);
    if (!converted) continue;
    bool detected = false;
    if (center) {
      uint32_t at = millis();
      detected = recognizeFrame(self, center, rgb, oldWidth, (oldWidth-centerWidth)/2, (oldHeight-centerHeight)/2, centerWidth, centerHeight);
      self->lastCenterMs = millis() - at;
    }
    // Keep an independent full-frame recognizer: no repeated buffer resizing,
    // and codes outside the center still get scanned every third pass.
    if (!detected && (!center || ++passes % 3 == 0)) {
      uint32_t at = millis();
      recognizeFrame(self, full, rgb, oldWidth, 0, 0, oldWidth, oldHeight);
      self->lastFullMs = millis() - at;
    }
    self->frames++; self->lastDecodeMs = millis() - started;
  }
}
void ESP32QRCodeReader::begin()
{
  beginOnCore(0);
}

void ESP32QRCodeReader::beginOnCore(BaseType_t core)
{
  if (!begun)
  {
    begun = xTaskCreatePinnedToCore(qrCodeDetectTask, "qrCodeDetectTask", QR_CODE_READER_STACK_SIZE, this, QR_CODE_READER_TASK_PRIORITY, &qrCodeTaskHandler, core) == pdPASS;
    if (!begun) Serial.println("QR reader task could not start.");
  }
}

bool ESP32QRCodeReader::receiveQrCode(struct QRCodeData *qrCodeData, long timeoutMs)
{
  return xQueueReceive(qrCodeQueue, qrCodeData, (TickType_t)pdMS_TO_TICKS(timeoutMs)) != 0;
}

void ESP32QRCodeReader::end()
{
  if (begun)
  {
    TaskHandle_t tmpTask = qrCodeTaskHandler;
    if (qrCodeTaskHandler != NULL)
    {
      qrCodeTaskHandler = NULL;
      vTaskDelete(tmpTask);
    }
  }
  begun = false;
}

void ESP32QRCodeReader::setDebug(bool on)
{
  debug = on;
}
