<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ปุ่มเติมเงินอั่งเปา</title>
    <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;600&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Prompt', sans-serif; }
        body { background: #f0f2f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; color: #333; }
        .topup-card { background: #ffffff; padding: 24px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); width: 100%; max-width: 380px; }
        .topup-title { font-size: 18px; font-weight: 600; color: #ff6600; margin-bottom: 16px; text-align: center; }
        .input-group { margin-bottom: 16px; }
        .input-group label { display: block; font-size: 13px; font-weight: 600; color: #555; margin-bottom: 6px; }
        .input-group input { width: 100%; padding: 10px 14px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; outline: none; transition: border-color 0.2s; }
        .input-group input:focus { border-color: #ff6600; }
        .btn-topup { width: 100%; background: #ff6600; color: #fff; border: none; padding: 12px; border-radius: 6px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
        .btn-topup:hover { background: #e05b00; }
        .btn-topup:disabled { background: #ffccaa; cursor: not-allowed; }
        #message { margin-top: 14px; padding: 10px; border-radius: 6px; font-size: 13px; text-align: center; display: none; }
        .msg-success { background: #e1fdf4; color: #00875a; border: 1px solid #abf5d1; }
        .msg-error { background: #ffebe6; color: #de350b; border: 1px solid #ffbdad; }
    </style>
</head>
<body>

<div class="topup-card">
    <div class="topup-title">🧧 เติมเงิน TrueMoney Wallet</div>
    <div class="input-group">
        <label>ลิงก์ซองอั่งเปา</label>
        <input type="text" id="voucherUrl" placeholder="https://gift.truemoney.com/campaign/?v=...">
    </div>
    <button class="btn-topup" id="submitBtn" onclick="handleTopup()">ยืนยันการเติมเงิน</button>
    <div id="message"></div>
</div>

<script>
    async function handleTopup() {
        const urlInput = document.getElementById('voucherUrl');
        const submitBtn = document.getElementById('submitBtn');
        const msgDiv = document.getElementById('message');
        const url = urlInput.value.trim();

        msgDiv.style.display = 'none';

        if (!url) {
            showMsg('msg-error', 'กรุณากรอกลิงก์ซองอั่งเปา');
            return;
        }

        const match = url.match(/v=([a-zA-Z0-9]+)/);
        if (!match) {
            showMsg('msg-error', 'ลิงก์ซองอั่งเปaไม่ถูกต้อง');
            return;
        }

        const voucherHash = match[1];

        submitBtn.disabled = true;
        submitBtn.innerText = 'กำลังตรวจสอบ...';

        try {
            // ตัวอย่างการเชื่อมต่อกับ Backend (เปลี่ยน URL ตามจริงเมื่อขึ้นเซิร์ฟเวอร์)
            const response = await fetch('http://localhost:3000/api/redeem', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ voucher_hash: voucherHash })
            });
            const data = await response.json();

            if (data.success) {
                showMsg('msg-success', '✅ เติมเงินสำเร็จ!');
                urlInput.value = '';
            } else {
                showMsg('msg-error', '❌ ' + (data.message || 'ซองถูกใช้งานแล้วหรือหมดอายุ'));
            }
        } catch (error) {
            showMsg('msg-error', '❌ ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = 'ยืนยันการเติมเงิน';
        }
    }

    function showMsg(className, text) {
        const msgDiv = document.getElementById('message');
        msgDiv.className = className;
        msgDiv.innerText = text;
        msgDiv.style.display = 'block';
    }
</script>

</body>
</html>
