require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');
const cors = require('cors');
const { Expo } = require('expo-server-sdk');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, private, max-age=0');
  res.set('Pragma', 'no-cache');
  next();
});

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || 'RotoMonsterAlerts',
  max: 10,
  idleTimeoutMillis: 30000
});

const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN,
  useFcmV1: true
});

const SPORTS = { 1: 'NBA', 2: 'MLB', 3: 'NFL', 4: 'NHL' };

const LEVELS = ['low', 'medium', 'high', 'monster'];

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeColor(value) {
  const v = value.trim().toLowerCase();
  return v.length === 4 ? '#' + v.slice(1).split('').map(ch => ch + ch).join('') : v;
}

const CUSTOMER_REPLY_PREFIX = '[Customer]';

async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS valid_codes (
        code text PRIMARY KEY,
        note text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS devices (
        code text PRIMARY KEY,
        push_token text,
        registration_id text,
        notifications_enabled boolean NOT NULL DEFAULT true,
        last_seen timestamptz NOT NULL DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        message_id text UNIQUE NOT NULL,
        sport_id integer,
        title text NOT NULL,
        body text,
        url text,
        notified boolean NOT NULL DEFAULT false,
        recipients integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        is_deleted boolean NOT NULL DEFAULT false
      )
    `);

    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS level text`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS status text`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS status_color text`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_player boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS owner_user_ids text[]`);
    await pool.query(`ALTER TABLE valid_codes ADD COLUMN IF NOT EXISTS user_id text`);
    await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS my_players_only boolean NOT NULL DEFAULT false`);

    await pool.query(`ALTER TABLE valid_codes ADD COLUMN IF NOT EXISTS is_staff boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS staff_only boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS staff_notifications boolean NOT NULL DEFAULT true`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_messages_created_at ON messages (created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_messages_sport ON messages (sport_id, created_at DESC)`);

    console.log('Database ready');
  } catch (error) {
    console.error('Database initialization failed:', error);
  }
}

initializeDatabase();

function isValidPushToken(token) {
  return token && (token.startsWith('ExponentPushToken[') || token.startsWith('simulator_token_'));
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function requireApiKey(req, res, next) {
  const configured = process.env.API_KEY;
  if (!configured) {
    console.warn('API_KEY not set - refusing protected request');
    return res.status(503).json({ success: false, error: 'Server not configured' });
  }
  if (!safeEqual(req.get('X-API-Key'), configured)) {
    return res.status(401).json({ success: false, error: 'Invalid or missing X-API-Key' });
  }
  next();
}

function requireWebhookSecret(req, res, next) {
  const configured = process.env.ZOHO_WEBHOOK_SECRET;
  if (!configured) {
    console.warn('ZOHO_WEBHOOK_SECRET not set - refusing webhook');
    return res.status(503).json({ success: false, error: 'Server not configured' });
  }
  if (!safeEqual(req.query.secret, configured)) {
    return res.status(401).json({ success: false, error: 'Invalid secret' });
  }
  next();
}

async function createMessage({ sportId, title, body, url, notify, level, status, statusColor, ownerUserIds, staffOnly }) {
  const shouldNotify = notify !== false;
  const messageId = uuidv4();
  const cleanTitle = title.trim();
  const cleanLevel = level || null;
  const cleanStatus = status || null;
  const cleanStatusColor = cleanStatus && statusColor ? statusColor : null;
  const owners = Array.isArray(ownerUserIds) ? ownerUserIds : null;
  const isPlayer = cleanStatus != null || owners != null;

  const inserted = await pool.query(
    `INSERT INTO messages (message_id, sport_id, title, body, url, notified, level, status, status_color, is_player, owner_user_ids, staff_only)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, message_id, sport_id, title, body, url, level, status, status_color, is_player, created_at`,
    [messageId, sportId ?? null, cleanTitle, body || null, url || null, shouldNotify, cleanLevel, cleanStatus, cleanStatusColor, isPlayer, owners, staffOnly === true]
  );

  const pushTitle = [
    cleanLevel === 'monster' ? 'MONSTER' : null,
    sportId ? SPORTS[sportId] : null,
    cleanTitle
  ].filter(Boolean).join(' - ');

  let sent = 0;

  if (shouldNotify) {
    const devices = await pool.query(
      `SELECT d.code, d.push_token, d.my_players_only, c.user_id
       FROM devices d
       LEFT JOIN valid_codes c ON c.code = d.code
       WHERE d.notifications_enabled = true${staffOnly === true ? ' AND c.is_staff = true AND d.staff_notifications = true' : ''}`
    );

    const ownerSet = new Set(owners || []);
    const pushMessages = devices.rows
      .filter(d => Expo.isExpoPushToken(d.push_token))
      .filter(d => !isPlayer || !d.my_players_only || (d.user_id != null && ownerSet.has(d.user_id)))
      .map(d => ({
        to: d.push_token,
        sound: 'default',
        title: pushTitle,
        body: body || '',
        data: {
          message_id: messageId,
          sport_id: sportId ?? null,
          url: url || null,
          level: cleanLevel,
          status: cleanStatus,
          status_color: cleanStatusColor,
          mine: d.user_id != null && ownerSet.has(d.user_id)
        },
        priority: 'high',
        channelId: 'default'
      }));

    if (pushMessages.length > 0) {
      try {
        for (const chunk of expo.chunkPushNotifications(pushMessages)) {
          await expo.sendPushNotificationsAsync(chunk);
        }
        sent = pushMessages.length;
        console.log(`Sent ${sent} notifications`);
      } catch (error) {
        console.error('Push send failed:', error);
      }
    }

    await pool.query('UPDATE messages SET recipients = $1 WHERE message_id = $2', [sent, messageId]);
  }

  return { messageId, notified: shouldNotify, sent, message: inserted.rows[0] };
}

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, database: 'connected' });
  } catch (error) {
    res.status(500).json({ success: false, database: 'error', error: error.message });
  }
});

app.post('/api/codes', requireApiKey, async (req, res) => {
  try {
    const { codes } = req.body;
    if (!Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({ success: false, error: 'codes must be a non-empty array' });
    }

    let added = 0;
    for (const entry of codes) {
      const code = (typeof entry === 'string' ? entry : entry.code || '').trim().toUpperCase();
      if (!code) continue;
      const note = typeof entry === 'string' ? null : entry.note || null;
      const userId = typeof entry === 'string' || entry.userId == null || entry.userId === '' ? null : String(entry.userId).trim();

      const result = await pool.query(
        `INSERT INTO valid_codes (code, note, user_id) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO NOTHING`,
        [code, note, userId]
      );
      added += result.rowCount;
    }

    res.json({ success: true, added });
  } catch (error) {
    console.error('Error adding codes:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/codes', requireApiKey, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.code, c.note, c.is_staff, c.user_id, c.created_at,
             (d.code IS NOT NULL) AS registered,
             d.last_seen
      FROM valid_codes c
      LEFT JOIN devices d ON d.code = c.code
      ORDER BY c.created_at DESC
    `);
    res.json({ success: true, codes: result.rows });
  } catch (error) {
    console.error('Error listing codes:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.put('/api/codes/:code', requireApiKey, async (req, res) => {
  try {
    const code = req.params.code.trim().toUpperCase();
    const userId = req.body.userId == null || req.body.userId === '' ? null : String(req.body.userId).trim();
    const result = await pool.query('UPDATE valid_codes SET user_id = $1 WHERE code = $2', [userId, code]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Code not found' });
    }
    res.json({ success: true, code, userId });
  } catch (error) {
    console.error('Error updating code:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.delete('/api/codes/:code', requireApiKey, async (req, res) => {
  try {
    const code = req.params.code.trim().toUpperCase();
    await pool.query('DELETE FROM devices WHERE code = $1', [code]);
    const result = await pool.query('DELETE FROM valid_codes WHERE code = $1', [code]);
    res.json({ success: true, deleted: result.rowCount > 0 });
  } catch (error) {
    console.error('Error deleting code:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { code, pushToken } = req.body;
    if (!code || !pushToken) {
      return res.status(400).json({ success: false, error: 'code and pushToken are required' });
    }

    const upperCode = code.trim().toUpperCase();

    const valid = await pool.query('SELECT 1 FROM valid_codes WHERE code = $1', [upperCode]);
    if (valid.rowCount === 0) {
      return res.status(400).json({ success: false, error: 'Invalid code. Contact administrator.' });
    }

    if (!isValidPushToken(pushToken)) {
      return res.status(400).json({ success: false, error: 'Invalid push token format' });
    }

    const registrationId = uuidv4();

    await pool.query(
      `INSERT INTO devices (code, push_token, registration_id, last_seen)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (code) DO UPDATE
         SET push_token = EXCLUDED.push_token,
             registration_id = EXCLUDED.registration_id,
             last_seen = now()`,
      [upperCode, pushToken, registrationId]
    );

    console.log(`Device registered: ${upperCode}`);
    res.json({ success: true, registrationId });
  } catch (error) {
    console.error('Error registering device:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/devices', requireApiKey, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT code, notifications_enabled, my_players_only, staff_notifications, last_seen FROM devices ORDER BY last_seen DESC'
    );
    res.json({ success: true, devices: result.rows });
  } catch (error) {
    console.error('Error listing devices:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.put('/api/device/:code/notifications', async (req, res) => {
  try {
    const code = req.params.code.trim().toUpperCase();
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'enabled must be true or false' });
    }

    const result = await pool.query(
      'UPDATE devices SET notifications_enabled = $1 WHERE code = $2',
      [enabled, code]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Device not registered' });
    }

    res.json({ success: true, enabled });
  } catch (error) {
    console.error('Error updating notification setting:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.put('/api/device/:code/filter', async (req, res) => {
  try {
    const code = req.params.code.trim().toUpperCase();
    const { myPlayersOnly } = req.body;

    if (typeof myPlayersOnly !== 'boolean') {
      return res.status(400).json({ success: false, error: 'myPlayersOnly must be true or false' });
    }

    const result = await pool.query(
      'UPDATE devices SET my_players_only = $1 WHERE code = $2',
      [myPlayersOnly, code]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Device not registered' });
    }

    res.json({ success: true, myPlayersOnly });
  } catch (error) {
    console.error('Error updating filter:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.put('/api/device/:code/staff-notifications', async (req, res) => {
  try {
    const code = req.params.code.trim().toUpperCase();
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'enabled must be true or false' });
    }

    const result = await pool.query(
      'UPDATE devices SET staff_notifications = $1 WHERE code = $2',
      [enabled, code]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Device not registered' });
    }

    res.json({ success: true, staffNotifications: enabled });
  } catch (error) {
    console.error('Error updating staff notification setting:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/device/:code/notifications-status', async (req, res) => {
  try {
    const code = req.params.code.trim().toUpperCase();
    const result = await pool.query(
      `SELECT d.notifications_enabled, d.my_players_only, d.staff_notifications, c.user_id, c.is_staff
       FROM devices d
       LEFT JOIN valid_codes c ON c.code = d.code
       WHERE d.code = $1`,
      [code]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Device not registered' });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      enabled: row.notifications_enabled,
      myPlayersOnly: row.my_players_only,
      linked: row.user_id != null,
      isStaff: row.is_staff === true,
      staffNotifications: row.staff_notifications
    });
  } catch (error) {
    console.error('Error reading notification setting:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

function normalizeAlertBody(b) {
  if (!b || typeof b !== 'object') return b;
  if (b.body === undefined && b.details !== undefined) b.body = b.details;
  if (b.level === undefined && b.alert_level !== undefined) b.level = String(b.alert_level).toLowerCase();
  if (b.statusColor === undefined && b.status_color !== undefined) b.statusColor = b.status_color;
  if (b.ownerUserIds === undefined && Array.isArray(b.users)) {
    b.ownerUserIds = b.users.map(u => String(u && u.user_id !== undefined ? u.user_id : u)).filter(Boolean);
    if (b.isPlayer === undefined) b.isPlayer = true;
  }
  if (b.sportId === undefined && b.sport_id === undefined) b.sportId = 1;
  return b;
}

app.use((req, res, next) => {
  const isSend = req.method === 'POST' && (req.path === '/api/message' || req.path === '/api/messages');
  const isUpdate = req.method === 'PUT' && req.path.startsWith('/api/messages/');
  if (isSend || isUpdate) {
    normalizeAlertBody(req.body);
    const json = res.json.bind(res);
    res.json = (payload) => json(payload && payload.messageId && payload.alert_id === undefined
      ? { ...payload, alert_id: payload.messageId }
      : payload);
  }
  if (req.method === 'POST' && req.path === '/api/messages') req.url = '/api/message';
  next();
});

app.post(['/api/message', '/api/messages'], requireApiKey, async (req, res) => {
  try {
    const { sportId, title, body, url, notify } = req.body;
    const level = req.body.level != null && req.body.level !== '' ? String(req.body.level).trim().toLowerCase() : null;
    const status = req.body.status != null && String(req.body.status).trim() !== '' ? String(req.body.status).trim() : null;
    const rawStatusColor = req.body.statusColor != null && String(req.body.statusColor).trim() !== '' ? String(req.body.statusColor) : null;
    const rawOwners = req.body.ownerUserIds;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'title is required' });
    }

    if (sportId != null && !SPORTS[sportId]) {
      return res.status(400).json({ success: false, error: 'sportId must be 1 (NBA), 2 (MLB), 3 (NFL), 4 (NHL) or omitted' });
    }

    if (level != null && !LEVELS.includes(level)) {
      return res.status(400).json({ success: false, error: 'level must be low, medium, high, monster or omitted' });
    }

    if (status != null && status.length > 40) {
      return res.status(400).json({ success: false, error: 'status must be 40 characters or fewer' });
    }

    if (rawStatusColor != null && !HEX_COLOR.test(rawStatusColor.trim())) {
      return res.status(400).json({ success: false, error: 'statusColor must be a hex color like #01A9DB' });
    }

    const statusColor = rawStatusColor != null ? normalizeColor(rawStatusColor) : null;

    if (rawOwners != null && !Array.isArray(rawOwners)) {
      return res.status(400).json({ success: false, error: 'ownerUserIds must be an array of user ids or omitted' });
    }

    const ownerUserIds = rawOwners == null
      ? null
      : [...new Set(rawOwners.map(id => String(id).trim()).filter(Boolean))];

    const result = await createMessage({ sportId, title, body, url, notify, level, status, statusColor, ownerUserIds, staffOnly: req.body.staffOnly === true });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error posting message:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function shorten(text, max) {
  const clean = stripHtml(text);
  return clean.length <= max ? clean : clean.slice(0, max - 1) + '…';
}

function ticketUrl(ticketId, webUrl) {
  if (webUrl) return webUrl;
  const template = process.env.ZOHO_TICKET_URL;
  return template && ticketId ? template.replace('{id}', ticketId) : null;
}

function describeZohoEvent(event) {
  const type = event.eventType || '';
  const p = event.payload || {};

  if (type === 'Ticket_Add') {
    const who = (p.contact && (p.contact.lastName || p.contact.email)) || p.email || 'Someone';
    return {
      title: `New support ticket #${p.ticketNumber || ''}`.trim(),
      body: `${who}: ${shorten(p.subject, 80)}${p.description ? ' - ' + shorten(p.description, 120) : ''}`,
      url: ticketUrl(p.id, p.webUrl)
    };
  }

  if (type === 'Ticket_Thread_Add') {
    if ((p.direction || '').toLowerCase() !== 'in') return null;
    const who = (p.author && (p.author.name || p.author.email)) || 'Customer';
    return {
      title: 'Customer replied to a support ticket',
      body: `${who}: ${shorten(p.summary || p.content, 160)}`,
      url: ticketUrl(p.ticketId)
    };
  }

  if (type === 'Ticket_Comment_Add') {
    const content = stripHtml(p.content);
    if (!content.startsWith(CUSTOMER_REPLY_PREFIX)) return null;
    return {
      title: 'Customer replied to a support ticket',
      body: shorten(content.slice(CUSTOMER_REPLY_PREFIX.length), 160),
      url: ticketUrl(p.ticketId)
    };
  }

  return null;
}

app.get('/api/zoho/webhook', (req, res) => res.status(200).send('ok'));
app.head('/api/zoho/webhook', (req, res) => res.status(200).end());

app.post('/api/zoho/webhook', requireWebhookSecret, async (req, res) => {
  const events = Array.isArray(req.body) ? req.body : [req.body];
  const results = [];

  if (process.env.ZOHO_WEBHOOK_LOG === 'true') {
    console.log('Zoho webhook:', JSON.stringify(req.body).slice(0, 4000));
  }

  for (const event of events) {
    try {
      const alert = describeZohoEvent(event || {});
      if (!alert) {
        results.push({ eventType: event && event.eventType, skipped: true });
        continue;
      }
      const created = await createMessage({ sportId: null, ...alert, notify: true, staffOnly: true });
      results.push({ eventType: event.eventType, messageId: created.messageId, sent: created.sent });
    } catch (error) {
      console.error('Zoho webhook event failed:', error);
      results.push({ eventType: event && event.eventType, error: true });
    }
  }

  res.status(200).json({ success: true, results });
});

async function canSeeStaff(req) {
  const key = req.get('X-API-Key');
  if (key && process.env.API_KEY && safeEqual(key, process.env.API_KEY)) return true;
  const code = (req.query.code || '').toString().trim().toUpperCase();
  if (!code) return false;
  const r = await pool.query('SELECT 1 FROM valid_codes WHERE code = $1 AND is_staff = true', [code]);
  return r.rowCount > 0;
}

app.put('/api/codes/:code/staff', requireApiKey, async (req, res) => {
  try {
    const code = req.params.code.trim().toUpperCase();
    const staff = req.body && req.body.staff === true;
    const result = await pool.query('UPDATE valid_codes SET is_staff = $1 WHERE code = $2', [staff, code]);
    res.json({ success: true, code, staff, updated: result.rowCount > 0 });
  } catch (error) {
    console.error('Error setting staff flag:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const hours = Math.min(Math.max(parseInt(req.query.hours || '12', 10) || 12, 1), 720);
    const sportId = req.query.sportId ? parseInt(req.query.sportId, 10) : null;

    const code = req.query.code ? String(req.query.code).trim().toUpperCase() : null;
    let userId = null;
    if (code) {
      const found = await pool.query('SELECT user_id FROM valid_codes WHERE code = $1', [code]);
      if (found.rowCount > 0) userId = found.rows[0].user_id;
    }

    const params = [hours];
    let where = `is_deleted = false AND created_at >= now() - ($1 || ' hours')::interval`;

    if (sportId) {
      params.push(sportId);
      where += ` AND sport_id = $${params.length}`;
    }

    if (!(await canSeeStaff(req))) where += ' AND staff_only = false';

    const result = await pool.query(
      `SELECT message_id, sport_id, title, body, url, level, status, status_color, is_player, owner_user_ids, created_at
       FROM messages
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT 500`,
      params
    );

    const messages = result.rows.map(({ owner_user_ids, ...m }) => ({
      ...m,
      mine: userId != null && Array.isArray(owner_user_ids) && owner_user_ids.includes(userId)
    }));

    res.json({ success: true, hours, sportId, count: result.rowCount, messages });
  } catch (error) {
    console.error('Error reading messages:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.delete('/api/messages/:messageId', requireApiKey, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE messages SET is_deleted = true WHERE message_id = $1',
      [req.params.messageId]
    );
    res.json({ success: true, deleted: result.rowCount > 0 });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.put('/api/messages/:messageId', requireApiKey, async (req, res) => {
  try {
    const { messageId } = req.params;
    const b = req.body || {};
    const level = b.level !== undefined ? String(b.level).toLowerCase() : null;
    if (level !== null && !['low', 'medium', 'high', 'monster'].includes(level)) {
      return res.status(400).json({ success: false, error: 'level must be low, medium, high or monster' });
    }
    const result = await pool.query(
      `UPDATE messages SET
         title = COALESCE($2, title),
         body = COALESCE($3, body),
         status = COALESCE($4, status),
         status_color = COALESCE($5, status_color),
         level = COALESCE($6, level)
       WHERE message_id = $1 AND is_deleted = false`,
      [messageId, b.title ?? null, b.body ?? null, b.status ?? null, b.statusColor ?? null, level]
    );
    if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Message not found' });
    res.json({ success: true, message: 'Message updated', messageId, alert_id: messageId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/sports', (req, res) => {
  res.json({
    success: true,
    sports: Object.entries(SPORTS).map(([id, name]) => ({ sportId: parseInt(id, 10), name }))
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`RotoMonster Alerts listening on ${PORT}`);
  });
}

module.exports = { app, describeZohoEvent };
