const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// ─── ENV CONFIG ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

// MarzPay — Base64 encoded API credentials
const MARZPAY_API_CREDENTIALS = 'bWFyel9TTmdZMHRwb1FVcFk1WmNoOndIRWdTT0lhUjhCUjNMMDV2NlZFUHFzMTBOZFdNZzU4';
const MARZPAY_BASE_URL = 'https://wallet.wearemarz.com/api/v1';

// EgoSMS
const EGOSMS_USERNAME = 'INFINITECH';
const EGOSMS_PASSWORD = 'Moses,123##';
const EGOSMS_SENDER = 'INFINITECH';

// Proxy auth
const API_SECRET = 'jubilee_proxy_secret_2024';

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

// ─── MARZPAY: COLLECT PAYMENT (Mobile Money) ────────────────────────────────

app.post('/api/collect', authenticate, async (req, res) => {
  try {
    const { phone_number, amount, description, callback_url } = req.body;

    if (!phone_number || !amount) {
      return res.status(400).json({ error: 'Missing phone_number or amount' });
    }

    // Normalize phone to +256 format
    let phone = phone_number.replace(/[\s\-]/g, '');
    if (phone.startsWith('0')) phone = '+256' + phone.substring(1);
    else if (phone.startsWith('256')) phone = '+' + phone;
    else if (!phone.startsWith('+')) phone = '+256' + phone;

    // Generate unique UUID reference
    const reference = crypto.randomUUID();

    console.log(`💰 Collecting UGX ${amount} from ${phone} | ref: ${reference}`);

    const formData = new URLSearchParams();
    formData.append('phone_number', phone);
    formData.append('amount', String(parseInt(amount)));
    formData.append('country', 'UG');
    formData.append('reference', reference);
    if (description) formData.append('description', description);
    if (callback_url) formData.append('callback_url', callback_url);

    const response = await fetch(`${MARZPAY_BASE_URL}/collect-money`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${MARZPAY_API_CREDENTIALS}`,
      },
      body: formData,
    });

    const data = await response.json();
    console.log(`💳 MarzPay response [${response.status}]:`, JSON.stringify(data));

    if (data.status === 'success') {
      return res.json({
        success: true,
        transaction_id: data.data?.transaction?.uuid || reference,
        reference: reference,
        message: data.message || 'Collection initiated',
        status: data.data?.transaction?.status || 'processing',
      });
    }

    return res.status(400).json({
      success: false,
      message: data.message || 'Collection failed',
      errors: data.errors || null,
    });
  } catch (err) {
    console.error('❌ Collect error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── MARZPAY: COLLECT VIA CARD ──────────────────────────────────────────────

app.post('/api/collect-card', authenticate, async (req, res) => {
  try {
    const { amount, description, callback_url } = req.body;

    if (!amount) {
      return res.status(400).json({ error: 'Missing amount' });
    }

    const reference = crypto.randomUUID();

    console.log(`💳 Card collection UGX ${amount} | ref: ${reference}`);

    const response = await fetch(`${MARZPAY_BASE_URL}/collect-money`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${MARZPAY_API_CREDENTIALS}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: parseInt(amount),
        method: 'card',
        reference: reference,
        country: 'UG',
        description: description || 'Premium payment',
      }),
    });

    const data = await response.json();
    console.log(`💳 Card response [${response.status}]:`, JSON.stringify(data));

    if (data.status === 'success') {
      return res.json({
        success: true,
        transaction_id: data.data?.transaction?.uuid || reference,
        reference: reference,
        redirect_url: data.data?.redirect_url || '',
        message: data.message,
      });
    }

    return res.status(400).json({ success: false, message: data.message });
  } catch (err) {
    console.error('❌ Card collect error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── MARZPAY: CHECK TRANSACTION STATUS ──────────────────────────────────────

app.get('/api/transaction/:uuid', authenticate, async (req, res) => {
  try {
    const { uuid } = req.params;

    const response = await fetch(`${MARZPAY_BASE_URL}/collect-money/${uuid}`, {
      headers: {
        'Authorization': `Basic ${MARZPAY_API_CREDENTIALS}`,
      },
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('❌ Status check error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── MARZPAY: GET AVAILABLE SERVICES ────────────────────────────────────────

app.get('/api/services', authenticate, async (req, res) => {
  try {
    const response = await fetch(`${MARZPAY_BASE_URL}/collect-money/services`, {
      headers: {
        'Authorization': `Basic ${MARZPAY_API_CREDENTIALS}`,
      },
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('❌ Services error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── MARZPAY: WEBHOOK RECEIVER ──────────────────────────────────────────────

app.post('/api/webhook/marzpay', (req, res) => {
  console.log('🔔 MarzPay webhook received:', JSON.stringify(req.body));
  // TODO: Update Firestore payment status based on event_type
  // collection.completed or collection.failed
  res.status(200).json({ received: true });
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

    res.json({ success: response.status === 200, message: text });
  } catch (err) {
    console.error('❌ SMS error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── START SERVER ────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 Jubilee Payment Proxy running on port ${PORT}`);
});
