process.on('uncaughtException', err => console.error('CRASH:', err));
process.on('unhandledRejection', err => console.error('CRASH:', err));

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Parsers to handle JSON and URL-encoded POST body data from Pesapal
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Serve static dashboard files
app.use(express.static(path.join(__dirname, 'public')));

const PESAPAL_CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY;
const PESAPAL_CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET;
const CALLBACK_URL = process.env.CALLBACK_URL; // e.g. https://traderscheem.duckdns.org/api/pesapal-ipn
const USD_TO_KES = 140;

const PESAPAL_BASE_URL = "https://pay.pesapal.com/v3/api"; // Live URL
let notificationId = '';

// 1. Get Token
async function getToken() {
    try {
        const response = await axios.post(`${PESAPAL_BASE_URL}/Auth/RequestToken`,
            { consumer_key: PESAPAL_CONSUMER_KEY, consumer_secret: PESAPAL_CONSUMER_SECRET },
            { headers: { "Content-Type": "application/json", Accept: "application/json" }, timeout: 10000 }
        );
        return response.data.token;
    } catch (error) {
        console.error("Pesapal Token Error:", error.response?.data || error.message);
        throw new Error("Could not get Pesapal token");
    }
}

// 2. Fetch or Register IPN ID on Startup
async function initIPN() {
    try {
        const token = await getToken();
        const response = await axios.post(`${PESAPAL_BASE_URL}/URLSetup/RegisterIPN`,
            { url: CALLBACK_URL, ipn_notification_type: "GET" },
            { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
        );
        notificationId = response.data.ipn_id;
        console.log("✅ Pesapal Notification ID:", notificationId);
    } catch (error) {
        console.error("IPN Setup Warning:", error.response?.data || error.message);
    }
}

// 3. Initiate Order Endpoint
app.post('/stkpush', async (req, res) => {
    try {
        const { amount, phone } = req.body;
        if (!amount || !phone) {
            return res.status(400).json({ success: false, message: "Amount and phone required" });
        }

        let formattedPhone = phone;
        if (phone.startsWith('0')) formattedPhone = '254' + phone.slice(1);
        if (phone.startsWith('+')) formattedPhone = phone.slice(1);

        const amountKES = Math.round(amount * USD_TO_KES);
        const token = await getToken();
        const orderId = "TS_" + Date.now();

        const pesapalResponse = await axios.post(`${PESAPAL_BASE_URL}/Transactions/SubmitOrderRequest`,
            {
                id: orderId,
                currency: "KES",
                amount: amountKES,
                description: `TraderScheem Deposit $${amount}`,
                // FIXED: Direct Pesapal POST responses to API route rather than static page
                callback_url: "https://traderscheem.duckdns.org/callback",
                notification_id: notificationId,
                billing_address: { 
                    phone_number: formattedPhone, 
                    email_address: "trader@traderscheem.com", 
                    country_code: "KE" 
                }
            },
            { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 15000 }
        );

        res.json({ 
            success: true, 
            redirect_url: pesapalResponse.data.redirect_url, 
            order_id: orderId 
        });

    } catch (error) {
        console.error("FULL PESAPAL ERROR:", JSON.stringify(error.response?.data || error.message));
        res.status(500).json({ success: false, message: error.response?.data?.error?.message || "Payment initiation failed" });
    }
});

// 4. Handles GET and POST callbacks from Pesapal & redirects safely back to trade.html
app.all('/callback', async (req, res) => {
    try {
        const orderTrackingId = req.query.OrderTrackingId || req.body.OrderTrackingId;

        if (orderTrackingId) {
            const token = await getToken();
            const statusRes = await axios.get(
                `${PESAPAL_BASE_URL}/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );

            const { payment_status_description, amount } = statusRes.data;

            if (payment_status_description === "Completed") {
                const amountUSD = amount / USD_TO_KES;
                console.log(`✅ Payment confirmed! Crediting $${amountUSD}`);
                // TODO: Update database balance here
            }
        }

        return res.redirect('/trade.html?status=success');

    } catch (error) {
        console.error("Callback Error:", error.message);
        return res.redirect('/trade.html?status=error');
    }
});

// 5. Catch-all fallback if Pesapal posts directly to trade.html
app.post('/trade.html', (req, res) => {
    res.redirect('/trade.html');
});

// App Listen
app.listen(PORT, async () => {
    console.log(`✅ Server running on port ${PORT}`);
    await initIPN();
});
