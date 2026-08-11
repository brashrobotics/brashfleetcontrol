# BRASH Fleet Control MVP

BRASH Robotics için fabrika içi filo ve görev yönetim prototipi. Uygulama gerçek zamanlıya yakın robot telemetrisi üreten dahili bir simülatörle gelir; harita, görev atama, robot seçimi, durum filtreleri, katmanlar, alarm akışı ve güvenli durdurma kontrolleri çalışır.

## Çalıştırma

Node.js 22 veya üzeri ile:

```powershell
node server.mjs
```

Ardından `http://127.0.0.1:4173` adresini açın.

## Doğrulama

```powershell
node --test tests/fleet-server.test.mjs
node --check public/app.js
```

## Gerçek robot entegrasyonu

Tarayıcı `/api/fleet/snapshot` ve `/api/fleet/stream` sözleşmelerini kullanır. Üretim sürümünde dahili simülatörün yerine ROS 2/MQTT adaptörü eklenebilir; arayüz aynı veri modeliyle çalışmaya devam eder.

Bu sürüm operasyon akışını doğrulamak için bir MVP'dir. Güvenlik PLC'si veya robotun gerçek zamanlı kontrol döngüsü yerine geçmez.
