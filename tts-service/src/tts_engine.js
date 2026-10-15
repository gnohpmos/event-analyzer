const { chromium } = require('playwright');

const TTS_URL = process.env.TTS_URL || 'https://nttts.nc.ntplc.co.th/sm/ess.do?lang=en';
const TTS_USERNAME = process.env.TTS_USERNAME || 'catma';
const TTS_PASSWORD = process.env.TTS_PASSWORD || 'Ait@1761@2';

/**
 * Core engine for automating ticket operations on NT TTS (HP Service Manager 9.72).
 */
class TTSEngine {
  /**
   * Splits a potentially composite Circuit ID (e.g. "TBB0005562+TBB147010")
   * into ordered, deduplicated candidate Circuit IDs.
   */
  static extractCircuitCandidates(circuitId) {
    if (!circuitId) return [];
    const raw = String(circuitId).trim();
    if (!raw) return [];
    const parts = raw.split(/[+,;/|]+/).map(p => p.trim()).filter(Boolean);
    const candidates = [];
    for (const part of parts) {
      if (!candidates.includes(part)) {
        candidates.push(part);
      }
    }
    if (candidates.length === 0) {
      candidates.push(raw);
    }
    return candidates;
  }

  /**
   * Performs login to NT TTS and automatically recovers from "Maximum active logins"
   * or stale session conflicts by releasing via goodbye.jsp and retrying once.
   */
  static async loginWithRetry(page) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      console.log(`[TTSEngine] Step 1: Logging in (attempt ${attempt}/2)...`);
      await page.goto(TTS_URL, { waitUntil: 'networkidle', timeout: 30000 });
      const userField = await page.$('#LoginUsername');
      if (userField) {
        await page.fill('#LoginUsername', TTS_USERNAME);
        await page.fill('#LoginPassword', TTS_PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(5000);
      }

      const bodyText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
      const loginStillVisible = await page.locator('#LoginUsername').isVisible().catch(() => false);
      const hasSessionConflict =
        bodyText.includes('Maximum active logins') ||
        bodyText.includes('exceeded the maximum') ||
        bodyText.includes('already logged in');

      if (!hasSessionConflict && !loginStillVisible) {
        return;
      }

      if (attempt === 1) {
        console.warn('[TTSEngine] Session conflict or login block detected. Releasing stale session via goodbye.jsp and retrying...');
        await page.goto('https://nttts.nc.ntplc.co.th/sm/goodbye.jsp?lang=en', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(2000);
      } else {
        throw new Error('ไม่สามารถเข้าสู่ระบบ NT TTS ได้หลังจากพยายามเคลียร์ Session ค้าง (Session Conflict / Login Failed)');
      }
    }
  }

  /**
   * Opens a new incident ticket in NT TTS.
   */
  static async openTicket({
    circuitId,
    assignmentGroup = 'ขทค. DATACOM [ Tier 1 ]',
    description,
    title = 'Down',
    contactName = 'catma',
    contactPhone = '0909070641',
    contactEmail = 'catma@ait.co.th',
    sourceLatitude = '',
    sourceLongitude = '',
    destLatitude = '',
    destLongitude = ''
  }) {
    if (!circuitId) {
      throw new Error('circuitId is required to open a ticket in NT TTS');
    }
    if (!description) {
      throw new Error('description is required to open a ticket in NT TTS');
    }

    const circuitCandidates = TTSEngine.extractCircuitCandidates(circuitId);
    let matchedCircuitId = circuitCandidates[0] || circuitId;

    console.log(`[TTSEngine] Starting ticket creation for Circuit: ${circuitId} (candidates: ${circuitCandidates.join(', ')})`);
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors']
    });
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1600, height: 1100 }
    });
    const page = await context.newPage();

    let result = {
      success: false,
      incident_id: null,
      interaction_id: null,
      circuit_id: matchedCircuitId,
      status: 'Open',
      assignment_group: assignmentGroup,
      fault_time: null,
      error: null
    };

    try {
      // 1. Login with automatic session conflict recovery
      await TTSEngine.loginWithRetry(page);

      // 2. Open New Ticket Navigation
      console.log('[TTSEngine] Step 2: Navigating to Open New Ticket...');
      const openTicketLink = page.locator("a:has-text('Open New Ticket'), [ext\\:tree-node-id*='Open New Ticket'] a").first();
      await openTicketLink.waitFor({ timeout: 12000 });
      await openTicketLink.click();
      await page.waitForTimeout(6000);

      const getDetailFrame = () => page.frames().find(f => f.url().includes('detail.do'));
      let activeFrame = getDetailFrame();
      if (!activeFrame) activeFrame = page.frames().find(f => f !== page.mainFrame());

      // 3. Search Circuit ID (supports composite Circuit ID candidates)
      const searchForCircuit = async (frame, cid) => {
        await frame.evaluate((val) => {
          const input = document.getElementById('X18') || document.querySelector('input[name="var/oss.search.value"]');
          if (input) {
            input.value = val;
            const ev = document.createEvent('HTMLEvents');
            ev.initEvent('input', true, true);
            input.dispatchEvent(ev);
            const evChange = document.createEvent('HTMLEvents');
            evChange.initEvent('change', true, true);
            input.dispatchEvent(evChange);
          }
        }, cid);

        const searchBtn = await frame.$('#X19Btn, button:has-text("Search")');
        if (searchBtn) {
          await searchBtn.click();
        } else {
          await frame.evaluate(() => {
            if (typeof tpzDrillTable === 'function') tpzDrillTable('', 'Search', '14', 'listdetail');
          });
        }
      };

      let resultLink = null;
      for (const candidate of circuitCandidates) {
        console.log(`[TTSEngine] Step 3: Searching Circuit ID candidate: ${candidate}...`);
        activeFrame = getDetailFrame() || activeFrame;
        await searchForCircuit(activeFrame, candidate);
        await page.waitForTimeout(5000);

        activeFrame = getDetailFrame() || activeFrame;
        resultLink = await activeFrame.$('a:has-text("Open New Ticket")');
        if (resultLink) {
          matchedCircuitId = candidate;
          result.circuit_id = candidate;
          console.log(`[TTSEngine] Step 4: Found circuit in TTS cache using candidate: ${candidate}`);
          break;
        }
      }

      // 4. If circuit record is not found in NT TTS cache for any candidate, attempt to pull from CSS (OSS)
      if (!resultLink) {
        for (const candidate of circuitCandidates) {
          activeFrame = getDetailFrame() || activeFrame;
          const pullBtn = await activeFrame.$('#X24Btn, button:has-text("ดึงข้อมูล Circuit ID")');
          if (!pullBtn) break;

          console.log(`[TTSEngine] Circuit ${candidate} not found in TTS cache. Attempting to pull from CSS via #X24Btn...`);
          await pullBtn.click();
          await page.waitForTimeout(6000);

          activeFrame = getDetailFrame() || activeFrame;
          // Fill Circuit ID into CSS Wizard field (#X6 / var/ossgetcatid.catid)
          const filled = await activeFrame.evaluate(({ val }) => {
            const el = document.getElementById('X6') || document.querySelector('input[name="var/ossgetcatid.catid"]');
            if (el) {
              el.value = val;
              try {
                const ev = el.ownerDocument.createEvent('HTMLEvents');
                ev.initEvent('input', true, true);
                el.dispatchEvent(ev);
              } catch(e) {}
              try {
                const ev = el.ownerDocument.createEvent('HTMLEvents');
                ev.initEvent('change', true, true);
                el.dispatchEvent(ev);
              } catch(e) {}
              if (typeof dvdOnChange === 'function') {
                try { dvdOnChange(el); } catch(e) {}
              }
              const ro = document.getElementById('X6Readonly');
              if (ro) ro.value = val;
              return true;
            }
            return false;
          }, { val: candidate });

          if (filled) {
            console.log(`[TTSEngine] Submitting CSS pull request for ${candidate}...`);
            const finishBtn = await activeFrame.$('#X9Btn, button:has-text("Finish")');
            if (finishBtn) {
              await finishBtn.click();
            } else {
              await activeFrame.evaluate(() => {
                if (typeof tpzDrillTable === 'function') tpzDrillTable('', 'Finish', '5', 'listdetail');
              });
            }
            await page.waitForTimeout(8000);

            // Re-navigate to Open New Ticket
            console.log(`[TTSEngine] Re-navigating to Open New Ticket after CSS pull for ${candidate}...`);
            const reOpenTicketLink = page.locator("a:has-text('Open New Ticket'), [ext\\:tree-node-id*='Open New Ticket'] a").first();
            await reOpenTicketLink.waitFor({ timeout: 12000 });
            await reOpenTicketLink.click();
            await page.waitForTimeout(6000);

            activeFrame = getDetailFrame() || page.frames().find(f => f !== page.mainFrame());
            await searchForCircuit(activeFrame, candidate);
            await page.waitForTimeout(5000);

            activeFrame = getDetailFrame() || activeFrame;
            resultLink = await activeFrame.$('a:has-text("Open New Ticket")');
            if (resultLink) {
              matchedCircuitId = candidate;
              result.circuit_id = candidate;
              console.log(`[TTSEngine] Found circuit after CSS pull using candidate: ${candidate}`);
              break;
            }
          }
        }
      }

      if (resultLink) {
        await resultLink.click();
      } else {
        const anyRowLink = await activeFrame.$('.x-grid3-row a, table a');
        if (anyRowLink) {
          await anyRowLink.click();
        } else {
          throw new Error(`ไม่พบข้อมูล Circuit ID ${circuitId} ในระบบ NT TTS หรือ OSS/CSS (กรุณาตรวจสอบความถูกต้องของ Circuit ID หรือสถานะในระบบต้นทาง)`);
        }
      }
      await page.waitForTimeout(8000);

      let formFrame = getDetailFrame();
      if (!formFrame) formFrame = activeFrame;

      // 5. Fill Form Fields using HPSM Native Widgets
      console.log('[TTSEngine] Step 5: Filling incident form fields...');
      const fillStatus = await formFrame.evaluate((params) => {
        function dispatchField(el, val) {
          if (!el) return false;
          el.value = val;
          try {
            const ev = el.ownerDocument.createEvent('HTMLEvents');
            ev.initEvent('input', true, true);
            el.dispatchEvent(ev);
          } catch(e) {}
          try {
            const ev = el.ownerDocument.createEvent('HTMLEvents');
            ev.initEvent('change', true, true);
            el.dispatchEvent(ev);
          } catch(e) {}
          if (typeof dvdOnChange === 'function') {
            try { dvdOnChange(el); } catch(e) {}
          }
          return true;
        }

        // Contact & Information info
        const infoEl = document.getElementById('X37');
        if (infoEl) dispatchField(infoEl, 'CATMA');
        const infoHidden = document.getElementById('X37Hidden');
        if (infoHidden) infoHidden.value = 'CATMA';
        const infoReadonly = document.getElementById('X37Readonly');
        if (infoReadonly) infoReadonly.value = 'CATMA';

        const contactEl = document.getElementById('X42');
        if (contactEl) dispatchField(contactEl, params.contactName);

        const phoneEl = document.getElementById('X46');
        if (phoneEl) dispatchField(phoneEl, params.contactPhone);

        const emailEl = document.getElementById('X50');
        if (emailEl) dispatchField(emailEl, params.contactEmail);

        // Assignment Group via HPSM Combo Widget
        const targetGroup = params.assignmentGroup || 'ขทค. DATACOM [ Tier 1 ]';
        const targetCode = targetGroup.includes('DATACOM') ? '2715141404' : '';
        const assignEl = document.getElementById('X100');
        if (assignEl) {
          assignEl.value = targetGroup;
          if (typeof assignEl.setComboValue === 'function') {
            assignEl.setComboValue(targetGroup);
          } else if (window.hpsm && window.hpsm.widgets && window.hpsm.widgets.Combo && window.hpsm.widgets.Combo.setValue) {
            try {
              window.hpsm.widgets.Combo.setValue.call(assignEl, targetGroup);
            } catch(e) {}
          }
          const assignHidden = document.getElementById('X100Hidden');
          if (assignHidden) assignHidden.value = targetCode || targetGroup;
          const assignReadonly = document.getElementById('X100Readonly');
          if (assignReadonly) assignReadonly.value = targetGroup;
          if (typeof dvdOnChange === 'function') dvdOnChange(assignEl);
        }

        // Title via HPSM Combo Widget
        const titleEl = document.getElementById('X140');
        if (titleEl) {
          titleEl.value = params.title;
          if (typeof titleEl.setComboValue === 'function') {
            titleEl.setComboValue(params.title);
          } else if (window.hpsm && window.hpsm.widgets && window.hpsm.widgets.Combo && window.hpsm.widgets.Combo.setValue) {
            try {
              window.hpsm.widgets.Combo.setValue.call(titleEl, params.title);
            } catch(e) {}
          }
          const titleHidden = document.getElementById('X140Hidden');
          if (titleHidden) titleHidden.value = params.title;
          if (typeof dvdOnChange === 'function') dvdOnChange(titleEl);
        }

        // Description via HPSM Textarea Widget
        const descEl = document.getElementById('X142');
        if (descEl) {
          descEl.value = params.description;
          const widget = descEl.wrapWidget || (window.hpsm && window.hpsm.widgets && window.hpsm.widgets.wrapWidget ? window.hpsm.widgets.wrapWidget(descEl) : null);
          if (widget && typeof widget.setValue === 'function') {
            widget.setValue(params.description);
            if (typeof widget.updateView === 'function') widget.updateView();
          }
          const viewEl = document.getElementById('X142View');
          if (viewEl) {
            viewEl.innerHTML = '<p>' + params.description.replace(/\n/g, '<br>') + '</p>';
          }
          if (typeof dvdOnChange === 'function') dvdOnChange(descEl);
        }

        // Fill GPS Coordinates on form if available and empty
        if (params.sourceLatitude) {
          const el = document.getElementById('X113');
          if (el && !el.value) dispatchField(el, params.sourceLatitude);
        }
        if (params.sourceLongitude) {
          const el = document.getElementById('X126');
          if (el && !el.value) dispatchField(el, params.sourceLongitude);
        }
        if (params.destLatitude) {
          const el = document.getElementById('X130');
          if (el && !el.value) dispatchField(el, params.destLatitude);
        }
        if (params.destLongitude) {
          const el = document.getElementById('X134');
          if (el && !el.value) dispatchField(el, params.destLongitude);
        }

        return {
          titleVal: titleEl ? titleEl.value : null,
          descVal: descEl ? descEl.value : null
        };
      }, {
        assignmentGroup,
        description,
        title,
        contactName,
        contactPhone,
        contactEmail,
        sourceLatitude,
        sourceLongitude,
        destLatitude,
        destLongitude
      });
      console.log('[TTSEngine] Form filled status:', fillStatus);

      // 6. Click Save & Exit
      console.log('[TTSEngine] Step 6: Submitting ticket (Save & Exit)...');
      const saveBtn = await formFrame.$('#X173Btn, button:has-text("Save & Exit")');
      if (!saveBtn) {
        throw new Error('Save & Exit button not found on Incident form');
      }
      await saveBtn.click();
      await page.waitForTimeout(10000);

      // Check for Solution Candidates or next wizard step
      formFrame = getDetailFrame() || formFrame;
      const solCandidatesBtn = await formFrame.$('button:has-text("Continue"), button:has-text("Finish")').catch(() => null);
      if (solCandidatesBtn && await solCandidatesBtn.isVisible()) {
        console.log('[TTSEngine] Solution Candidates dialog present, clicking Continue/Finish...');
        await solCandidatesBtn.click();
        await page.waitForTimeout(6000);
      }

      // 7. Verify and Fetch Created Ticket Record
      console.log(`[TTSEngine] Step 7: Searching created ticket record to confirm IDs for ${matchedCircuitId}...`);
      const searchTicketLink = page.locator("a:has-text('Search Ticket'), [ext\\:tree-node-id*='Search Ticket'] a").first();
      await searchTicketLink.click();
      await page.waitForTimeout(5000);

      formFrame = getDetailFrame() || formFrame;
      await formFrame.locator('#X15').fill(matchedCircuitId);
      const doSearchBtn = await formFrame.$('button:has-text("Search"), input[value="Search"], #btnSearch');
      if (doSearchBtn) await doSearchBtn.click();
      await page.waitForTimeout(5000);

      formFrame = getDetailFrame() || formFrame;
      const rows = await formFrame.evaluate(() => {
        return Array.from(document.querySelectorAll('tr, .x-grid3-row')).map(r => r.innerText.trim()).filter(t => t.length > 5);
      });

      const ACTIVE_ROW_STATUSES = [
        'Open',
        'Investigation',
        'Work In Progress',
        'Dispatched',
        'Assigned 1st',
        'Assigned 2nd',
        'Assigned',
        'Pending'
      ];

      // 1. Collect all matching active rows for matchedCircuitId (or any candidate) and pick the highest (newest) SD/IM IDs
      const matchedImIds = [];
      const matchedSdIds = [];
      let newestRowTime = null;
      let highestSdSeen = '';

      for (const row of rows) {
        const matchesCircuit = circuitCandidates.some(cid => row.includes(cid));
        const matchesStatus = ACTIVE_ROW_STATUSES.some(st => row.includes(st));
        if (matchesCircuit && matchesStatus) {
          const imMatches = row.match(/IM2\d{7}/g) || row.match(/IM\d{8}/g) || [];
          const sdMatches = row.match(/SD2\d{7}/g) || row.match(/SD\d{8}/g) || [];
          const timeMatch = row.match(/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}/);

          matchedImIds.push(...imMatches);
          matchedSdIds.push(...sdMatches);

          const rowMaxSd = sdMatches.length ? [...sdMatches].sort().reverse()[0] : '';
          if (timeMatch && (!newestRowTime || rowMaxSd >= highestSdSeen)) {
            newestRowTime = timeMatch[0];
            if (rowMaxSd) highestSdSeen = rowMaxSd;
          }
        }
      }

      if (matchedImIds.length > 0) {
        result.incident_id = [...new Set(matchedImIds)].sort().reverse()[0];
      }
      if (matchedSdIds.length > 0) {
        result.interaction_id = [...new Set(matchedSdIds)].sort().reverse()[0];
      }
      if (newestRowTime) {
        result.fault_time = newestRowTime;
      }
      result.success = !!(result.interaction_id || result.incident_id);

      // 2. Fallback / Detail View: when HPSM auto-drills into a single record or rows lack circuitId text
      if (!result.interaction_id || !result.incident_id) {
        const fallbackSdIds = [];
        const fallbackImIds = [];
        for (const fr of page.frames()) {
          try {
            const html = await fr.evaluate(() => document.body.innerHTML);
            const sdMatches = html.match(/SD2\d{7}/g) || html.match(/SD\d{8}/g) || [];
            const imMatches = html.match(/IM2\d{7}/g) || html.match(/IM\d{8}/g) || [];
            const timeMatch = html.match(/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}/);

            fallbackSdIds.push(...sdMatches);
            fallbackImIds.push(...imMatches);
            if (timeMatch && !result.fault_time) {
              result.fault_time = timeMatch[0];
            }
          } catch(e) {}
        }
        if (!result.interaction_id && fallbackSdIds.length > 0) {
          result.interaction_id = [...new Set(fallbackSdIds)].sort().reverse()[0];
        }
        if (!result.incident_id && fallbackImIds.length > 0) {
          result.incident_id = [...new Set(fallbackImIds)].sort().reverse()[0];
        }
        result.success = !!(result.interaction_id || result.incident_id);
      }

      console.log('[TTSEngine] Ticket Creation Result:', result);
      return result;

    } catch (err) {
      console.error('[TTSEngine] Error during ticket opening:', err);
      result.error = err.message;
      return result;
    } finally {
      // MANDATORY: Always release the single active session slot
      console.log('[TTSEngine] Releasing user session via Logout and goodbye.jsp...');
      try {
        const logoutLink = page.locator("a:has-text('Logout'), [ext\\:tree-node-id*='Logout'] a").first();
        if (await logoutLink.isVisible()) {
          await logoutLink.click();
          await page.waitForTimeout(2000);
        }
      } catch(e) {}
      try {
        await page.goto('https://nttts.nc.ntplc.co.th/sm/goodbye.jsp?lang=en', { timeout: 10000 });
        console.log('[TTSEngine] Session released successfully.');
      } catch (e) {
        console.warn('[TTSEngine] Error releasing session:', e.message);
      }
      await browser.close().catch(() => {});
    }
  }

  /**
   * Searches for existing open tickets for a circuit.
   */
  static async checkExistingTicket(circuitId) {
    const circuitCandidates = TTSEngine.extractCircuitCandidates(circuitId);
    const primaryCid = circuitCandidates[0] || circuitId;
    console.log(`[TTSEngine] Checking existing tickets for: ${circuitId} (primary: ${primaryCid})`);
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors']
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, ignoreHTTPSErrors: true });

    try {
      await TTSEngine.loginWithRetry(page);

      const searchTicketLink = page.locator("a:has-text('Search Ticket'), [ext\\:tree-node-id*='Search Ticket'] a").first();
      await searchTicketLink.click();
      await page.waitForTimeout(5000);

      let formFrame = page.frames().find(f => f.url().includes('detail.do')) || page.frames().find(f => f !== page.mainFrame());
      await formFrame.locator('#X15').fill(primaryCid);
      const doSearchBtn = await formFrame.$('button:has-text("Search"), input[value="Search"], #btnSearch');
      if (doSearchBtn) await doSearchBtn.click();
      await page.waitForTimeout(5000);

      formFrame = page.frames().find(f => f.url().includes('detail.do')) || formFrame;
      const rows = await formFrame.evaluate(() => {
        return Array.from(document.querySelectorAll('tr, .x-grid3-row')).map(r => r.innerText.trim()).filter(t => t.length > 5);
      });

      const ACTIVE_ROW_STATUSES = [
        'Open',
        'Investigation',
        'Work In Progress',
        'Dispatched',
        'Assigned 1st',
        'Assigned 2nd',
        'Assigned',
        'Pending'
      ];

      const openTickets = [];
      for (const row of rows) {
        const matchesCircuit = circuitCandidates.some(cid => row.includes(cid));
        const matchesStatus = ACTIVE_ROW_STATUSES.some(st => row.includes(st));
        if (matchesCircuit && matchesStatus) {
          const imMatch = row.match(/IM2\d{7}/) || row.match(/IM\d{8}/);
          const sdMatch = row.match(/SD2\d{7}/) || row.match(/SD\d{8}/);
          if (imMatch || sdMatch) {
            openTickets.push({
              incident_id: imMatch ? imMatch[0] : null,
              interaction_id: sdMatch ? sdMatch[0] : null,
              raw_row: row
            });
          }
        }
      }

      // Sort descending by interaction_id / incident_id so newest ticket is first
      openTickets.sort((a, b) => {
        const keyA = a.interaction_id || a.incident_id || '';
        const keyB = b.interaction_id || b.incident_id || '';
        return keyB.localeCompare(keyA);
      });

      return {
        has_open_ticket: openTickets.length > 0,
        tickets: openTickets
      };
    } finally {
      try {
        const logoutLink = page.locator("a:has-text('Logout'), [ext\\:tree-node-id*='Logout'] a").first();
        if (await logoutLink.isVisible()) {
          await logoutLink.click();
          await page.waitForTimeout(2000);
        }
      } catch(e) {}
      await page.goto('https://nttts.nc.ntplc.co.th/sm/goodbye.jsp?lang=en').catch(() => {});
      await browser.close().catch(() => {});
    }
  }
}

module.exports = TTSEngine;
