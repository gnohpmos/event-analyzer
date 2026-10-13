const express = require('express');
const cors = require('cors');
require('dotenv').config();

const TTSEngine = require('./tts_engine');

const app = express();
const PORT = process.env.PORT || 8088;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

/**
 * Sequential execution queue to strictly enforce Single-Session Concurrency (catma).
 */
class ExecutionQueue {
  constructor() {
    this.chain = Promise.resolve();
    this.pendingCount = 0;
  }

  enqueue(fn) {
    this.pendingCount++;
    return new Promise((resolve, reject) => {
      this.chain = this.chain
        .then(async () => {
          try {
            const res = await fn();
            resolve(res);
          } catch (err) {
            reject(err);
          } finally {
            this.pendingCount--;
          }
        })
        .catch((err) => {
          // Keep chain alive on previous errors
          this.pendingCount--;
          reject(err);
        });
    });
  }
}

const queue = new ExecutionQueue();

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'eventanalyzer-tts-gateway',
    pending_queue_count: queue.pendingCount,
    timestamp: new Date().toISOString()
  });
});

/**
 * Open Ticket Endpoint
 * POST /api/v1/tts/open-ticket
 */
app.post('/api/v1/tts/open-ticket', async (req, res) => {
  const {
    circuit_id, assignment_group, description, title,
    contact_name, contact_phone, contact_email,
    source_latitude, source_longitude, dest_latitude, dest_longitude
  } = req.body;

  if (!circuit_id) {
    return res.status(400).json({ success: false, error: 'circuit_id is required' });
  }
  if (!description) {
    return res.status(400).json({ success: false, error: 'description is required' });
  }

  console.log(`[Server] Received open-ticket request for Circuit: ${circuit_id}. Queue size: ${queue.pendingCount}`);

  try {
    const result = await queue.enqueue(() => {
      return TTSEngine.openTicket({
        circuitId: circuit_id,
        assignmentGroup: assignment_group,
        description: description,
        title: title || 'Down',
        contactName: contact_name,
        contactPhone: contact_phone,
        contactEmail: contact_email,
        sourceLatitude: source_latitude,
        sourceLongitude: source_longitude,
        destLatitude: dest_latitude,
        destLongitude: dest_longitude
      });
    });

    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(500).json(result);
    }
  } catch (err) {
    console.error('[Server] Execution error:', err);
    return res.status(500).json({
      success: false,
      error: err.message,
      circuit_id: circuit_id
    });
  }
});

/**
 * Check Existing Ticket Endpoint
 * POST /api/v1/tts/check-ticket
 */
app.post('/api/v1/tts/check-ticket', async (req, res) => {
  const { circuit_id } = req.body;
  if (!circuit_id) {
    return res.status(400).json({ success: false, error: 'circuit_id is required' });
  }

  try {
    const result = await queue.enqueue(() => {
      return TTSEngine.checkExistingTicket(circuit_id);
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[Server] Check ticket error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[TTS Service] Listening on http://0.0.0.0:${PORT}`);
});
