<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ระบบเติมเงินอั่งเปา</title>
    <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;600&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Prompt', sans-serif; }
        body { background: #05030b; display: flex; justify-content: center; align-items: center; min-height: 100vh; color: #f4eeff; }
        .card { background: #0f0a1d; padding: 24px; border-radius: 12px; border: 1px solid #2d2252; box-shadow: 0 4px 20px rgba(255,46,154,0.2); width: 100%; max-width: 380px; }
        .title { font-size: 18px; font-weight: 600; color: #ff2e9a; margin-bottom: 16px; text-align: center; }
        .group { margin-bottom: 16px; }
        label { display: block; font-size: 13px; font-weight: 600; color: #a093c8; margin-bottom: 6px; }
        input { width: 100%; padding: 10px 14px; border: 1px solid #2d2252; background: #09051a; color: #f4eeff; border-radius: 6px; font-size: 14px; outline: none; }
        input:focus { border-color: #ff2e9a; }
        .btn { width: 100%; background: linear-gradient(135deg, #8a5cff, #ff2e9a); color: #fff; border: none; padding: 12px; border-radius: 6px; font-size: 15px; font-weight: 600; cursor: pointer; }
        .btn:hover { filter: brightness(1.1); }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        #msg { margin-top: 14px; padding: 10px; border-radius: 6px; font-size: 13px; text-align: center; display: none; }
        .success { background: rgba(0,255,150,0.1); color: #3dff7a; border: 1px solid rgba(0,255,150,0.3); }
        .error { background: rgba(255,46,99,0.1); color: #ff7a8a; border: 1px solid rgba(255,46,99,0.3); }
    </style>
</head>
<body>

<div class="card">
    <div class="title">🧧 เติมเงินอั่งเปา TrueMoney</div>
    <div class="group">
        <label>ลิงก์ซองอั่งเปา</label>
        <input type="text" id="url" placeholder="https://gift.truemoney.com/campaign/?v=...">
    </div>
    <button class="btn" id="btn" onclick="topup()">ยืนยันการเติมเงิน</button>
    <div id="msg"></div>
</div>

<script>
    async function topup() {
        const urlIn = document.getElementById('url');
        const btn = document.getElementById('btn');
        const msg = document.getElementById('msg');
        const val = urlIn.value.trim();
        
        msg.style.display = 'none';
        if(!val) return show('error', 'กรุณากรอกลิงก์ซองอั่งเปา');

        const match = val.match(/v=([a-zA-Z0-9]+)/);
        if(!match) return show('error', 'ลิงก์ซองอั่งเปาไม่ถูกต้อง');

        btn.disabled = true; 
        btn.innerText = 'กำลังเติมเงิน...';

        try {
            const res = await fetch('http://localhost:3000/api/redeem', {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ voucher_hash: match[1] })
            });
            const data = await res.json();
            
            if(data.success) { 
                show('success', '✅ เติมเงินสำเร็จ! ได้รับ ' + (data.amount || 0) + ' บาท'); 
                urlIn.value = ''; 
            } else { 
                show('error', '❌ ' + (data.message || 'ซองไม่ถูกต้อง')); 
            }
        } catch (err) { 
            show('error', '❌ เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (รัน Backend หรือยัง?)'); 
        } finally { 
            btn.disabled = false; 
            btn.innerText = 'ยืนยันการเติมเงิน'; 
        }
    }

    function show(c, t) { 
        const m = document.getElementById('msg'); 
        m.className = c; 
        m.innerText = t; 
        m.style.display = 'block'; 
    }
</script>

</body>
</html>
