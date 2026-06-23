// GitHub üzerinde api/track.js olarak kaydedin
const { kv } = require('@vercel/kv'); // Ücretsiz ve kurulumu çok kolay Vercel veri deposu

const LUA_TEMPLATE = `-- HubTrack Analytics [Private Hub]
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")

local TRACKING_URL = "https://" .. game:GetService("HttpService"):GetAsync("https://api.ipify.org") -- Dinamik URL tespiti veya direkt kendi vercel linkiniz
local TRACKING_KEY = "TRACKING_KEY_PLACEHOLDER"
local HUB_SECRET   = "HUB_SECRET_PLACEHOLDER"

local function gatherAndSend(success, err)
    task.spawn(function()
        local p = Players.LocalPlayer
        while not p do task.wait() p = Players.LocalPlayer end
        
        local payload = HttpService:JSONEncode({
            trackingKey = TRACKING_KEY,
            executor = identifyexecutor and identifyexecutor() or "Unknown",
            userId = p.UserId,
            username = p.Name,
            placeId = game.PlaceId,
            success = success,
            error = err and tostring(err) or nil
        })
        
        pcall(function()
            HttpService:PostAsync("APP_URL_PLACEHOLDER/api/track", payload, Enum.HttpContentType.ApplicationJson, false, {
                ["X-Hub-Secret"] = HUB_SECRET
            })
        end)
    end)
end

local function runWrapped(f)
    local s, r = pcall(f)
    gatherAndSend(s, not s and r or nil)
    if not s then error(r) end
end

runWrapped(function()
`;

export default async function handler(req, res) {
    // CORS Ayarları (Her yerden erişim için)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Secret');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const MY_SECRET = process.env.MY_HUB_SECRET_KEY;

    // 1. DURUM: ROBLOX'TAN VERİ GELİYORSA (POST)
    if (req.method === 'POST') {
        const hubAuthHeader = req.headers['x-hub-secret'];
        if (!MY_SECRET || hubAuthHeader !== MY_SECRET) {
            return res.status(401).json({ error: 'Yetkisiz Erişim' });
        }

        const data = req.body;
        // Gelen veriyi Vercel KV veri deposuna saniyeler içinde kaydet
        const recordId = `log:${data.trackingKey}:${Date.now()}`;
        await kv.set(recordId, data);

        return res.status(200).json({ status: 'success' });
    }

    // 2. DURUM: TARAYICIDAN SCRIPT OLUŞTURMA İSTEĞİ GELİYORSA (GET)
    if (req.method === 'GET') {
        const { action, name, code, key } = req.query;

        // Script Oluşturma Aşaması
        if (action === 'create' && code) {
            const trackingKey = 'hub_' + Math.random().toString(36).substring(2, 11);
            
            // Orijinal scripti KV'ye kaydet
            await kv.set(`script:${trackingKey}`, { name, originalCode: code });

            const appUrl = `https://${req.headers.host}`;
            let modifiedLua = LUA_TEMPLATE
                .replace('TRACKING_KEY_PLACEHOLDER', trackingKey)
                .replace('HUB_SECRET_PLACEHOLDER', MY_SECRET || "")
                .replace('APP_URL_PLACEHOLDER', appUrl)
                + '\n' + code + '\n\nend)';

            return res.status(200).json({ modifiedLua, trackingKey });
        }

        // Verileri Dashboard için listeleme aşaması
        if (action === 'data') {
            const keys = await kv.keys('log:*');
            const logs = [];
            for (const k of keys) {
                const log = await kv.get(k);
                logs.push(log);
            }
            return res.status(200).json(logs);
        }

        return res.status(400).json({ error: 'Geçersiz işlem' });
    }
}
  
