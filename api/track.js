import { MongoClient } from 'mongodb';

let cachedClient = null;

async function connectToDatabase() {
    if (cachedClient) return cachedClient;

    const client = await MongoClient.connect(process.env.MONGODB_URI, {
        maxPoolSize: 10
    });

    cachedClient = client;
    return client;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Secret');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const MY_SECRET = process.env.MY_HUB_SECRET_KEY;

    try {
        const client = await connectToDatabase();
        const db = client.db('hubtrack');

        // Roblox analytics
        if (req.method === 'POST' && !req.body.action) {
            const hubAuthHeader = req.headers['x-hub-secret'];

            if (!MY_SECRET || hubAuthHeader !== MY_SECRET) {
                return res.status(401).json({ error: 'Yetkisiz' });
            }

            const data = req.body;
            data.createdAt = new Date();

            await db.collection('analytics').insertOne(data);
            return res.status(200).json({ status: 'success' });
        }

        // Create script
        if (req.method === 'POST' && req.body.action === 'create') {
            const { name, code } = req.body;

            const trackingKey =
                'hub_' + Math.random().toString(36).substring(2, 11);

            await db.collection('scripts').insertOne({
                name,
                trackingKey,
                originalCode: code,
                createdAt: new Date()
            });

            const appUrl = `https://${req.headers.host}`;

            const LUA_TEMPLATE = `-- HubTrack Analytics
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")

local function gatherAndSend(success, err)
    task.spawn(function()
        local p = Players.LocalPlayer
        while not p do task.wait() p = Players.LocalPlayer end
        
        local payload = HttpService:JSONEncode({
            trackingKey = "${trackingKey}",
            executor = identifyexecutor and identifyexecutor() or "Unknown",
            userId = p.UserId,
            username = p.Name,
            placeId = game.PlaceId,
            success = success,
            error = err and tostring(err) or nil
        })

        pcall(function()
            HttpService:PostAsync("${appUrl}/api/track", payload, Enum.HttpContentType.ApplicationJson, false, {
                ["X-Hub-Secret"] = "${MY_SECRET || ''}"
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

            const modifiedLua = LUA_TEMPLATE + '\n' + code + '\n\nend)';

            return res.status(200).json({
                modifiedLua,
                trackingKey
            });
        }

        if (req.method === 'GET') {
            const { action } = req.query;

            if (action === 'data') {
                const logs = await db
                    .collection('analytics')
                    .find({})
                    .sort({ createdAt: -1 })
                    .limit(50)
                    .toArray();

                return res.status(200).json(logs);
            }
        }

        return res.status(400).json({ error: 'Geçersiz işlem' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
}
