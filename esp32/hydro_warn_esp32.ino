/**
 * =========================================================================
 * HydroWarn - ESP32 Fire Alarm & Sensor Monitoring System
 * =========================================================================
 * Deskripsi:
 * - Membaca sensor suhu & kelembaban (DHT22 dengan fallback DHT11).
 * - Menyalakan Relay jika suhu >= 33.0 °C ATAU kelembaban >= 30.0 %.
 * - FITUR: Relay / Alarm OTOMATIS MATI setelah 5 detik (Non-blocking timer).
 * - Mengirim HTTP POST JSON ke endpoint Next.js Vercel (/api/sensor).
 * - Memicu PWA Push Notification darurat ke HP/browser.
 * =========================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "DHT.h"

// -------------------------------------------------------------------------
// 1. Konfigurasi WiFi
// -------------------------------------------------------------------------
const char* ssid     = "NAMA_WIFI_KAMU";      // Ganti dengan SSID WiFi Anda
const char* password = "PASSWORD_WIFI_KAMU";  // Ganti dengan Password WiFi Anda

// -------------------------------------------------------------------------
// 2. Konfigurasi Endpoint Server
// -------------------------------------------------------------------------
const char* serverUrl = "https://hydrowarn.vercel.app/api/sensor";

// -------------------------------------------------------------------------
// 3. Konfigurasi Pin Hardware
// -------------------------------------------------------------------------
#define DHT11_PIN  4      // Pin Data DHT11
#define DHT22_PIN  5      // Pin Data DHT22
#define RELAY_PIN  18     // Pin Kendali Relay (Aktuator)

// Tipe Sensor DHT
#define DHT11_TYPE DHT11
#define DHT22_TYPE DHT22

// Inisialisasi Objek Sensor
DHT dht11(DHT11_PIN, DHT11_TYPE);
DHT dht22(DHT22_PIN, DHT22_TYPE);

// -------------------------------------------------------------------------
// 4. Parameter Ambang Batas (Threshold) & Logika Relay
// -------------------------------------------------------------------------
const float AMBANG_SUHU_TRIGGER   = 33.0; // Pemicu Suhu >= 33.0 °C
const float AMBANG_LEMBAP_TRIGGER = 30.0; // Pemicu Kelembapan >= 30.0 %

// Modul relay umumnya Aktif LOW
#define RELAY_ON   LOW
#define RELAY_OFF  HIGH

// -------------------------------------------------------------------------
// 5. Timer Non-Blocking & Kontrol Alarm Otomatis Mati 5 Detik
// -------------------------------------------------------------------------
unsigned long previousMillis = 0;
const unsigned long intervalKirim = 5000; // Kirim data setiap 5 detik

// Pengaturan durasi alarm 5 detik
const unsigned long DURASI_ALARM_NYALA = 5000; // 5000 ms = 5 detik
bool alarmSedangAktif = false;                 // Status apakah alarm sedang menyala
unsigned long waktuAlarmMulai = 0;             // Waktu saat alarm pertama kali dinyalakan
bool kondisiBahayaSebelumnya = false;          // Deteksi tepi (edge-detection)

// -------------------------------------------------------------------------
// Fungsi: Koneksi WiFi (Non-blocking loop friendly)
// -------------------------------------------------------------------------
void hubungkanWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.println("[WiFi] Menghubungkan ke: " + String(ssid));
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 10000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Terhubung! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[WiFi] Gagal terhubung. Akan dicoba kembali di siklus berikutnya.");
  }
}

// -------------------------------------------------------------------------
// Fungsi: Kirim Payload JSON ke Endpoint Vercel
// -------------------------------------------------------------------------
void kirimDataJson(float suhu, float hum, bool relayState) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] Batal kirim: WiFi belum terhubung.");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();   // Bypass validasi sertifikat SSL agar hemat memori ESP32
  client.setTimeout(10);  // Timeout koneksi socket 10 detik

  HTTPClient http;
  if (!http.begin(client, serverUrl)) {
    Serial.println("[HTTP] Inisialisasi HTTPClient gagal.");
    return;
  }

  http.setTimeout(10000); // Timeout HTTP request 10 detik
  http.addHeader("Content-Type", "application/json");

  // Format payload JSON: {"suhu": 34.2, "humidity": 31.0, "relay": true}
  String payload = "{\"suhu\":" + String(suhu, 1) + 
                   ",\"humidity\":" + String(hum, 1) + 
                   ",\"relay\":" + (relayState ? "true" : "false") + "}";

  Serial.println("[HTTP] Mengirim data ke: " + String(serverUrl));
  Serial.println("[HTTP] Payload: " + payload);

  int httpResponseCode = http.POST(payload);

  if (httpResponseCode > 0) {
    Serial.print("[HTTP] Response Code: ");
    Serial.println(httpResponseCode);
    String response = http.getString();
    Serial.println("[HTTP] Server Response: " + response);
  } else {
    Serial.print("[HTTP] Error kirim POST: ");
    Serial.println(http.errorToString(httpResponseCode));
  }

  http.end();
  client.stop(); // Bersihkan resource TLS socket
}

// -------------------------------------------------------------------------
// Setup Utama
// -------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n=======================================================");
  Serial.println("  HydroWarn - ESP32 Inisialisasi Dimulai               ");
  Serial.println("  Fitur: Alarm Otomatis Mati Setelah 5 Detik Aktif    ");
  Serial.println("=======================================================");

  // Inisialisasi Pin Relay
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF); // Pastikan relay awal dalam kondisi MATI

  // Inisialisasi Sensor DHT
  dht11.begin();
  dht22.begin();

  // Koneksi ke WiFi
  hubungkanWiFi();

  Serial.println("[SETUP] Siap membaca sensor & memantau kondisi kebakaran.");
}

// -------------------------------------------------------------------------
// Loop Utama
// -------------------------------------------------------------------------
void loop() {
  // Jaga koneksi WiFi tetap aktif
  if (WiFi.status() != WL_CONNECTED) {
    hubungkanWiFi();
  }

  unsigned long currentMillis = millis();

  // -----------------------------------------------------------------------
  // FITUR: Periksa apakah alarm sudah menyala selama 5 detik
  // Jika sudah >= 5000 ms, matikan relay secara otomatis!
  // -----------------------------------------------------------------------
  if (alarmSedangAktif && (currentMillis - waktuAlarmMulai >= DURASI_ALARM_NYALA)) {
    digitalWrite(RELAY_PIN, RELAY_OFF); // Matikan relay
    alarmSedangAktif = false;
    Serial.println("\n[ALARM TIMER] ⏱️ 5 Detik telah berlalu -> Relay ALARM DIMATIKAN OTOMATIS!");
  }

  // -----------------------------------------------------------------------
  // Siklus Pembacaan Sensor & Pengiriman Data (Tiap 5 Detik)
  // -----------------------------------------------------------------------
  if (currentMillis - previousMillis >= intervalKirim) {
    previousMillis = currentMillis;

    // Baca sensor DHT11 & DHT22
    float suhu11 = dht11.readTemperature();
    float hum11  = dht11.readHumidity();

    float suhu22 = dht22.readTemperature();
    float hum22  = dht22.readHumidity();

    bool dht11_error = isnan(suhu11) || isnan(hum11);
    bool dht22_error = isnan(suhu22) || isnan(hum22);

    // Prioritas sensor DHT22, fallback ke DHT11 jika DHT22 bermasalah
    float suhuAcuan = NAN;
    float humAcuan  = NAN;
    String sumberSensor = "None";

    if (!dht22_error) {
      suhuAcuan = suhu22;
      humAcuan  = hum22;
      sumberSensor = "DHT22";
    } else if (!dht11_error) {
      suhuAcuan = suhu11;
      humAcuan  = hum11;
      sumberSensor = "DHT11 (Fallback)";
    }

    Serial.println("----------------------------------------");
    if (!isnan(suhuAcuan) && !isnan(humAcuan)) {
      Serial.println("[SENSOR] Sumber: " + sumberSensor);
      Serial.println("[SENSOR] Suhu: " + String(suhuAcuan, 1) + " °C | Kelembaban: " + String(humAcuan, 1) + " %");

      // Cek apakah kondisi melewati ambang batas bahaya
      bool kondisiBahaya = (suhuAcuan >= AMBANG_SUHU_TRIGGER || humAcuan >= AMBANG_LEMBAP_TRIGGER);

      if (kondisiBahaya) {
        // Jika baru pertama kali mendeteksi bahaya (transisi aman -> bahaya):
        if (!kondisiBahayaSebelumnya) {
          digitalWrite(RELAY_PIN, RELAY_ON);     // Nyalakan relay
          alarmSedangAktif = true;
          waktuAlarmMulai = millis();            // Catat waktu mulai
          kondisiBahayaSebelumnya = true;
          Serial.println("[STATUS] 🚨 BAHAYA TERDETEKSI! Relay ON -> Alarm Kebakaran Menyala (Mati otomatis dalam 5 detik).");
        } else {
          Serial.println("[STATUS] ⚠️ Kondisi masih di atas ambang batas. (Alarm sudah selesai berbunyi 5 detik sebelumnya).");
        }
      } else {
        // Kondisi kembali normal
        if (kondisiBahayaSebelumnya) {
          Serial.println("[STATUS] 🛡️ Kondisi suhu & kelembaban kembali NORMAL. Sistem direset.");
        }
        kondisiBahayaSebelumnya = false;
        if (alarmSedangAktif) {
          digitalWrite(RELAY_PIN, RELAY_OFF);
          alarmSedangAktif = false;
        }
      }

      // Cek status fisik pin relay saat ini
      bool statusRelayFisik = (digitalRead(RELAY_PIN) == RELAY_ON);

      // Kirim data ke API Vercel
      kirimDataJson(suhuAcuan, humAcuan, statusRelayFisik || alarmSedangAktif);

    } else {
      Serial.println("[ERROR] Kedua sensor (DHT11 & DHT22) gagal dibaca!");
      digitalWrite(RELAY_PIN, RELAY_OFF);
      alarmSedangAktif = false;
    }
    Serial.println("----------------------------------------");
  }
}
