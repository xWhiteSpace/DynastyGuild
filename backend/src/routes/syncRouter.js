import { Router } from 'express';
import { getDatabase } from '../db/database.js';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import fs from 'fs'; 
import path from 'path';
dotenv.config();

const router = Router();

function normalizeDateStr(dateStr) {
  if (!dateStr) return '';
  const clean = dateStr.trim().replace(/[-\.]/g, '/');
  const parts = clean.split('/');
  if (parts.length === 3) {
    let month, day, year;
    if (parts[0].length === 4) {
      year = parts[0];
      month = parseInt(parts[1], 10);
      day = parseInt(parts[2], 10);
    } else {
      month = parseInt(parts[0], 10);
      day = parseInt(parts[1], 10);
      year = parts[2];
    }
    if (!isNaN(month) && !isNaN(day) && !isNaN(year)) {
      return `${month}/${day}/${year}`;
    }
  }
  return dateStr.trim();
}

function parseCSVToRawArrays(csvText, headerMatchKeyword) {
  const lines = csvText.split(/\r?\n/);
  let tableStarted = false;
  const dataRows = [];
  for (let line of lines) {
    if (!line.trim()) continue;
    const cleanLine = line.replace(/^\ufeff/, '');
    const cells = cleanLine.split(',').map(c => c.trim().replace(/^"|"$/g, '').trim());
    if (!tableStarted) {
      if (cells.map(c => c.toLowerCase()).includes(headerMatchKeyword.toLowerCase())) {
        tableStarted = true;
      }
      continue;
    }
    if (cells.every(c => c === '')) continue;
    dataRows.push(cells);
  }
  return dataRows;
}

// 🌟 AUTOMATED SYNCHRONIZATION ENGINE (STRICT ENUMS ONLY)
export async function executeSpreadsheetSync() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) return;

  try {
    const historyUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=LootHistory`;
    const historyRes = await fetch(historyUrl);
    const historyText = await historyRes.text();
    const historyRows = parseCSVToRawArrays(historyText, 'Date');

    let rawActiveDate = '';
    historyRows.forEach(row => {
      const rowDate = (row[0] || '').trim();
      if (rowDate && rowDate.includes('/')) {
        if (!rawActiveDate || new Date(rowDate) > new Date(rawActiveDate)) {
          rawActiveDate = rowDate;
        }
      }
    });

    if (!rawActiveDate) return;
    const normalizedAnchor = normalizeDateStr(rawActiveDate);

    const computedTally = {
      puppet: { current: 0, max: 0 },
      illu: { current: 0, max: 0 },
      lnd: { current: 0, max: 0 },
      tns: { current: 0, max: 0 }
    };

    historyRows.forEach(row => {
      if (normalizeDateStr(row[0]) === normalizedAnchor) {
        const type = (row[2] || '').trim().toLowerCase();
        const droppedQty = parseInt(row[3], 10) || 0;
        if (type === 'puppet') computedTally.puppet.max = droppedQty;
        if (type === 'illu') computedTally.illu.max = droppedQty;
        if (type === 'light&dark') computedTally.lnd.max = droppedQty;
        if (type === 'time&space') computedTally.tns.max = droppedQty;
      }
    });

    const itemTabs = ['Puppet', 'Illu', 'Light&Dark', 'Time&Space'];
    for (const tabName of itemTabs) {
      const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      const itemRows = parseCSVToRawArrays(text, 'Member');
      const shortKey = tabName === 'Light&Dark' ? 'lnd' : tabName === 'Time&Space' ? 'tns' : tabName.toLowerCase();

      itemRows.forEach(row => {
        if (normalizeDateStr(row[0] || '') === normalizedAnchor) {
          for (let i = 3; i < row.length; i++) {
            const cellVal = (row[i] || '').trim().toLowerCase();
            if (cellVal === 'bid complete' || cellVal === 'not sold') {
              computedTally[shortKey].current++;
            }
          }
        }
      });
    }

    const requestUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=RequestHistory`;
    const requestRes = await fetch(requestUrl);
    const requestText = await requestRes.text();
    const requestRows = parseCSVToRawArrays(requestText, 'Member');

    let nowPlayerName = null;
    let nextPlayerName = null;
    const standbyPlayerNames = new Set();
    const requestItemsList = [];

    // Pass 1: Identify Now and Next Roles Strictly
    requestRows.forEach(row => {
      if (normalizeDateStr(row[0] || '') !== normalizedAnchor) return;
      const player = row[1]?.trim();
      if (!player || player === '???') return;

      const biddingStatus = row[6]?.trim().toLowerCase(); // Column G LiveStatus
      if (biddingStatus === 'now') nowPlayerName = player;
      if (biddingStatus === 'next') nextPlayerName = player;
    });

    // Pass 2: Apply Option A Deduplication Guard to Standby Selections
    requestRows.forEach(row => {
      if (normalizeDateStr(row[0] || '') !== normalizedAnchor) return;
      const player = row[1]?.trim();
      if (!player || player === '???') return;

      const biddingStatus = row[6]?.trim().toLowerCase();
      if (biddingStatus === 'standby') {
        if (player !== nowPlayerName && player !== nextPlayerName) {
          standbyPlayerNames.add(player);
        }
      }
    });

    // Pass 3: CHRONOLOGICAL NET QUANTITY AGGREGATOR WITH SELECTION GUARD
    if (nowPlayerName) {
      const targetLowerName = nowPlayerName.toLowerCase();
      const itemAggregatorMap = {};

      requestRows.forEach(row => {
        if (normalizeDateStr(row[0] || '') !== normalizedAnchor) return;
        if (row[1]?.trim().toLowerCase() !== targetLowerName) return;
        
        const itemType = (row[2] || '').trim();
        const itemQty = parseInt(row[3], 10) || 0;
        const appStatus = (row[4] || '').trim().toLowerCase(); // Column E ApplicationStatus
        const selStatus = (row[5] || '').trim().toLowerCase(); // Column F SelectionStatus
        
        if (!itemType) return;
        if (!itemAggregatorMap[itemType]) {
          itemAggregatorMap[itemType] = 0;
        }

        // 🛡️ SELECTION GUARD ANTI-LEAK RULE
        // An item is only added to the active live bidding list if it was explicitly marked 'Selected'
        if (selStatus === 'selected') {
          if (appStatus === 'requested') {
            itemAggregatorMap[itemType] += itemQty;
          } else if (appStatus === 'canceled') {
            itemAggregatorMap[itemType] -= itemQty;
          }
        }
      });

      Object.keys(itemAggregatorMap).forEach(itemType => {
        const netQty = itemAggregatorMap[itemType];
        if (netQty > 0) {
          requestItemsList.push(`[${itemType}] - ${netQty}`);
        }
      });
    }

    const queueOutput = {
      now: nowPlayerName ? { name: nowPlayerName, items: requestItemsList } : null,
      next: nextPlayerName ? { name: nextPlayerName } : null,
      standby: Array.from(standbyPlayerNames).map(name => ({ name }))
    };

    const db = getDatabase();
    await db.ref('auction/tally').set(computedTally);
    await db.ref('auction/queue').set(queueOutput);

    // Firebase Web-to-Sheet Write-back Module
    const requestsSnapshot = await db.ref('auction/web_requests').once('value');
    if (requestsSnapshot.exists()) {
      const webRequestsMap = requestsSnapshot.val();
      const webRequestsEntries = Object.entries(webRequestsMap);

      try {
        let cleanEmail = '';
        let cleanKey = '';
        const jsonPath = path.join(process.cwd(), 'ragnarokdynasty-4afa9f4eaa31.json');
        
        if (fs.existsSync(jsonPath)) {
          const credentials = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
          cleanEmail = credentials.client_email;
          cleanKey = credentials.private_key;
        } else if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
          cleanEmail = process.env.GOOGLE_CLIENT_EMAIL.trim().replace(/^["']|["']$/g, '');
          cleanKey = process.env.GOOGLE_PRIVATE_KEY.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
        }

        if (cleanEmail && cleanKey) {
          const auth = new google.auth.JWT(cleanEmail, null, cleanKey, ['https://www.googleapis.com/auth/spreadsheets']);
          const sheets = google.sheets({ version: 'v4', auth });
          
          const checkSheetRange = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'RequestHistory!A:B'
          });

          const absoluteLastTextRow = checkSheetRange.data.values ? checkSheetRange.data.values.length : 1;
          const directTargetWriteRow = absoluteLastTextRow + 1; 

          const rowsToAppend = [];
          const keysToClear = [];

          webRequestsEntries.forEach(([key, req]) => {
            rowsToAppend.push([
              req.date || '',
              req.member || '',
              req.item || '',
              req.quantity || 0,
              req.applicationStatus || 'Requested',
              req.selectionStatus || 'Pending',
              '', 
              req.priority || 0
            ]);
            keysToClear.push(key);
          });

          if (rowsToAppend.length > 0) {
            console.log(`📤 [WRITE-BACK] Target row selected: Line ${directTargetWriteRow}. Migrating data...`);
            await sheets.spreadsheets.values.update({
              spreadsheetId,
              range: `RequestHistory!A${directTargetWriteRow}:H`,
              valueInputOption: 'USER_ENTERED',
              requestBody: { values: rowsToAppend }
            });

            for (const key of keysToClear) {
              await db.ref(`auction/web_requests/${key}`).remove();
            }
            console.log(`✅ [WRITE-BACK SUCCESS] Successfully populated requests into your table grid layout.`);
          }
        }
      } catch (writeBackError) {
        console.error('❌ [WRITE-BACK TRANSMISSION ERROR]:', writeBackError.message);
      }
    }
  } catch (error) {
    console.error('❌ [SYNC FATAL FAULT] Background loop interrupted:', error.message);
  }
}

router.get('/status', (req, res) => {
  res.json({ success: true, message: 'Quiet production loop is running smoothly.' });
});

export default router;