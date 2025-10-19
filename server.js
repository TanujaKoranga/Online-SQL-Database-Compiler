// server.js

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const session = require('express-session'); // ✅ Added for session handling

const app = express();
const PORT = 3000;

// ✅ Session Middleware
app.use(session({
    secret: 'super-secret-key', // you can change it later
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 } // 1 hour
}));

// Connect to SQLite
const db = new sqlite3.Database(path.join(__dirname, 'practice.db'), (err) => {
    if (err) console.error("Error connecting to database:", err.message);
    else console.log("Connected to the SQLite database.");
});

// Middleware
app.use(express.static(__dirname)); 
app.use(express.json());

// ✅ LOGIN API — store user session
app.post('/login', (req, res) => {
    const { name, email } = req.body;
    if (!name || !email) {
        return res.status(400).json({ success: false, message: 'Invalid login data' });
    }
    req.session.user = { name, email };
    res.json({ success: true, name });
});

// ✅ USER INFO API — check if logged in
app.get('/user', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, name: req.session.user.name });
    } else {
        res.json({ loggedIn: false });
    }
});

// ✅ LOGOUT API
app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ success: false, message: 'Logout failed' });
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// ===============================================================
// Your Original SQL Compiler Endpoints (unchanged below)
// ===============================================================

// Helper function to fetch table data and schema
const fetchTableDataAndSchema = (tableName) => {
    if (!tableName) return Promise.resolve({ rows: [], columns: [] });
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM ${tableName}`, (err, rows) => {
            if (err) return reject(err);
            db.all(`PRAGMA table_info(${tableName})`, (err, info) => {
                if (err) return reject(err);
                const columns = info.map(col => ({
                    name: col.name.toLowerCase(),
                    type: col.type.toUpperCase().split('(')[0],
                    pk: col.pk === 1
                }));
                resolve({ rows, columns });
            });
        });
    });
};

// Execute SQL
app.post('/api/execute-sql', async (req, res) => {
    const { query } = req.body;
    const cleanedQuery = query.trim();
    const upperQuery = cleanedQuery.toUpperCase();
    const isSelect = upperQuery.startsWith('SELECT');
    const tableMatch = cleanedQuery.match(/\b(FROM|INTO|TABLE)\s+['"]?(\w+)['"]?/i);
    const tableName = tableMatch ? tableMatch[2] : null;

    if (!cleanedQuery) return res.status(400).json({ type: 'error', message: 'Query cannot be empty.' });

    if (isSelect) {
        db.all(cleanedQuery, [], (err, rows) => {
            if (err) return res.status(500).json({ type: 'error', message: "SQL ERROR: " + err.message });
            res.json({ type: 'query', message: `${rows.length} rows retrieved.`, data: rows });
        });
    } else {
        try {
            const previousState = await fetchTableDataAndSchema(tableName).catch(e => {
                if (!upperQuery.includes('CREATE TABLE') && e.message.includes('no such table')) throw e;
                return { rows: [], columns: [] };
            });
            await new Promise((resolve, reject) => {
                db.run(cleanedQuery, function (err) {
                    if (err) return reject(err);
                    resolve({ affectedRows: this.changes || 0 });
                });
            }).then(result => {
                const affectedRows = result.affectedRows;
                const action = upperQuery.split(/\s+/)[0];
                if (action === 'DROP' && upperQuery.includes('TABLE')) {
                    return res.json({ type: 'success', message: `Table '${tableName}' dropped successfully.`, data: null });
                }
                fetchTableDataAndSchema(tableName).then(updatedState => {
                    let modificationMessage = `${affectedRows} rows affected by ${action}.`;
                    if (action === 'CREATE') modificationMessage = `Table '${tableName}' created successfully.`;
                    if (action === 'ALTER') modificationMessage = `Table '${tableName}' structure updated.`;
                    res.json({
                        type: 'dual_query',
                        message: modificationMessage,
                        previousData: { rows: previousState.rows, columns: previousState.columns },
                        updatedData: updatedState
                    });
                });
            });
        } catch (e) {
            res.status(500).json({ type: 'error', message: "SQL ERROR: " + e.message });
        }
    }
});

// Fetch Schema
app.get('/api/schema', (req, res) => {
    const sql = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";
    db.all(sql, [], (err, tables) => {
        if (err) return res.status(500).json({ type: 'error', message: err.message });
        const schema = {};
        let completed = 0;
        if (tables.length === 0) return res.json({});
        tables.forEach(t => {
            const tableName = t.name;
            Promise.all([
                new Promise((resolve, reject) => {
                    db.all(`PRAGMA table_info(${tableName})`, (err, info) => {
                        if (err) return reject(err);
                        const columns = info.map(col => ({
                            name: col.name.toLowerCase(),
                            type: col.type.toUpperCase().split('(')[0],
                            pk: col.pk === 1
                        }));
                        resolve(columns);
                    });
                }),
                new Promise((resolve, reject) => {
                    db.get(`SELECT COUNT(*) as count FROM ${tableName}`, (err, row) => {
                        if (err) return reject(err);
                        resolve(row ? row.count : 0);
                    });
                })
            ]).then(([columns, rowsCount]) => {
                schema[tableName] = { columns, rows: rowsCount };
                if (++completed === tables.length) res.json(schema);
            }).catch(() => {
                if (++completed === tables.length) res.json(schema);
            });
        });
    });
});

// Start server
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
