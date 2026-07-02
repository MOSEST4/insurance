const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

// ─── ENV CONFIG ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

const MARZPAY_ACCESS_ID = process.env.MARZPAY_ACCESS_ID || '';
const MARZPAY_ACCESS_TOKEN = process.env.MARZPAY_ACCESS_TOKEN || '';
const MARZPAY_BASE_URL = process.env.MARZPAY_BASE_URL || 'https://wallet.wearemarz.com';

const EGOSMS_USERNAME = process.env.EGOSMS_USERNAME || 'INFINITECH';
const EGOSMS_PASSWORD = process.env.EGOSMS_PASSWORD || 'Moses,123##';
const EGOSMS_SENDER = process.env.EGOSMS_SENDER || 'INFINITECH';

const API_SECRET = process.env.API_SECRET || 'jubilee_proxy_secret_2024';

// ─── AUTH MIDDLEWARE ─────────────────────────────────────────────────────────

function authenticate(req, res, next) {
  const token = req.headers['x-api-key'];
  if (token !== API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Jubilee Insurance Payment Proxy' });
});

// ─── MARZPAY: DISBURSE TO MOBILE MONEY ──────────────────────────────────────

app.post('/api/disburse', authenticate, async (req, res) => {
  try {
    const { phone_number, amount, claim_id, recipient_name } = req.body;

    if (!phone_number || !amount || !claim_id) {
      return res.status(400).json({ error: 'Missing required fields: phone_number, amount, claim_id' });
    }

    // Normalize phone
    let phone = phone_number.replace(/[\+\s\-]/g, '');
    if (phone.startsWith('0')) phone = '256' + phone.substring(1);
    else if (!phone.startsWith('256')) phone = '256' + phone;

    console.log(`💰 Disbursing UGX ${amount} to ${phone} for claim #${claim_id}`);

    // MarzPay single-endpoint with module parameter
    const payload = {
      accessId: MARZPAY_ACCESS_ID,
      accessToken: MARZPAY_ACCESS_TOKEN,
      module: 'withdraw',
      phone: phone,
      amount: parseInt(amount),
      reason: `Insurance Claim Payout - #${claim_id}`,
      reference: `JUB-CLAIM-${claim_id}`,
      narration: `Jubilee Insurance payout to ${recipient_name || phone}`,
    };

    const response = await fetch(MARZPAY_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log(`💳 MarzPay response [${response.status}]:`, data);

    if (data.success || data.status === 'success' || response.status === 200) {
      return res.json({
        success: true,
        transaction_id: data.transactionId || data.transaction_id || data.id || '',
        message: data.message || 'Payment sent',
        status: data.status || 'completed',
      });
    }

    return res.status(400).json({
      success: false,
      message: data.message || data.error || 'Payment failed',
    });
  } catch (err) {
    console.error('❌ Disburse error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── MARZPAY: CHECK TRANSACTION STATUS ──────────────────────────────────────

app.get('/api/transaction/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const payload = {
      accessId: MARZPAY_ACCESS_ID,
      accessToken: MARZPAY_ACCESS_TOKEN,
      module: 'transactionStatus',
      transactionId: id,
    };

    const response = await fetch(MARZPAY_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('❌ Status check error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── MARZPAY: CHECK BALANCE ─────────────────────────────────────────────────

app.get('/api/balance', authenticate, async (req, res) => {
  try {
    const payload = {
      accessId: MARZPAY_ACCESS_ID,
      accessToken: MARZPAY_ACCESS_TOKEN,
      module: 'balance',
    };

    const response = await fetch(MARZPAY_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('❌ Balance error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── EGOSMS: SEND SMS ────────────────────────────────────────────────────────

app.post('/api/sms', authenticate, async (req, res) => {
  try {
    const { phone_number, message } = req.body;

    if (!phone_number || !message) {
      return res.status(400).json({ error: 'Missing phone_number or message' });
    }

    let phone = phone_number.replace(/[\+\s\-]/g, '');
    if (phone.startsWith('0')) phone = '256' + phone.substring(1);
    else if (!phone.startsWith('256')) phone = '256' + phone;

    console.log(`📲 Sending SMS to ${phone}`);

    const url = `https://www.egosms.co/api/v1/plain/?number=${phone}&message=${encodeURIComponent(message)}&username=${EGOSMS_USERNAME}&password=${encodeURIComponent(EGOSMS_PASSWORD)}&sender=${EGOSMS_SENDER}`;

    const response = await fetch(url);
    const text = await response.text();

    console.log(`📨 EgoSMS response [${response.status}]: ${text}`);

    res.json({
      success: response.status === 200,
      message: text,
    });
  } catch (err) {
    console.error('❌ SMS error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── START SERVER ────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 Jubilee Payment Proxy running on port ${PORT}`);
});
