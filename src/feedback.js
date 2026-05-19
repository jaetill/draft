// Custom feedback widget per platform Standard 11 Tier 2.
// Renders a small "Feedback" button; opens a modal form on click.
// Submits to POST /feedback on the meal-planner HTTP API.

import { API_BASE } from './config.js';

const FEEDBACK_ENDPOINT = `${API_BASE}/feedback`;

export function initFeedbackWidget() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButton);
  } else {
    injectButton();
  }
}

function injectButton() {
  if (document.getElementById('draft-feedback-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'draft-feedback-btn';
  btn.type = 'button';
  btn.textContent = 'Feedback';
  btn.setAttribute('aria-label', 'Send feedback');
  btn.style.cssText = [
    'position:fixed', 'bottom:5rem', 'right:1rem', 'z-index:9999',
    'padding:.5rem 1rem', 'background:#16a34a', 'color:white',
    'border:none', 'border-radius:6px', 'cursor:pointer',
    'font-size:.875rem', 'box-shadow:0 2px 8px rgba(0,0,0,0.15)',
  ].join(';');
  btn.addEventListener('click', openForm);
  document.body.appendChild(btn);
}

function openForm() {
  const existing = document.getElementById('draft-feedback-dialog');
  if (existing) { existing.focus(); return; }

  const dialog = document.createElement('dialog');
  dialog.id = 'draft-feedback-dialog';
  dialog.innerHTML = `
    <form method="dialog" id="draft-feedback-form" style="display:flex;flex-direction:column;gap:.75rem;min-width:320px;max-width:480px;padding:.5rem;">
      <h3 style="margin:0;font-size:1.125rem;">Send feedback</h3>
      <label style="display:flex;flex-direction:column;gap:.25rem;font-size:.875rem;">
        Type
        <select name="type" required style="padding:.5rem;border:1px solid #cbd5e1;border-radius:4px;">
          <option value="bug">Bug</option>
          <option value="feature">Feature request</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label style="display:flex;flex-direction:column;gap:.25rem;font-size:.875rem;">
        What happened? (10-2000 characters)
        <textarea name="description" rows="5" minlength="10" maxlength="2000" required
          style="padding:.5rem;border:1px solid #cbd5e1;border-radius:4px;font-family:inherit;"></textarea>
      </label>
      <label style="display:flex;flex-direction:column;gap:.25rem;font-size:.875rem;">
        Email (optional, for follow-up)
        <input type="email" name="email" placeholder="optional"
          style="padding:.5rem;border:1px solid #cbd5e1;border-radius:4px;">
      </label>
      <input type="text" name="website" tabindex="-1" autocomplete="off"
        aria-hidden="true" style="position:absolute;left:-9999px;">
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:.5rem;">
        <button type="button" id="draft-feedback-cancel"
          style="padding:.5rem 1rem;background:#e2e8f0;color:#1e293b;border:none;border-radius:4px;cursor:pointer;">
          Cancel
        </button>
        <button type="submit" id="draft-feedback-submit"
          style="padding:.5rem 1rem;background:#16a34a;color:white;border:none;border-radius:4px;cursor:pointer;">
          Submit
        </button>
      </div>
      <p id="draft-feedback-status" style="margin:0;font-size:.75rem;color:#64748b;min-height:1.25em;"></p>
      <small style="color:#94a3b8;">We collect only what you type. Email is optional and used only to follow up.</small>
    </form>
  `;
  document.body.appendChild(dialog);
  dialog.showModal();

  dialog.querySelector('#draft-feedback-cancel').addEventListener('click', () => {
    dialog.close();
    dialog.remove();
  });

  dialog.querySelector('#draft-feedback-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = dialog.querySelector('#draft-feedback-submit');
    const status = dialog.querySelector('#draft-feedback-status');
    submitBtn.disabled = true;
    status.textContent = 'Sending...';

    const fd = new FormData(e.target);
    const payload = {
      type: fd.get('type'),
      description: fd.get('description'),
      page_url: window.location.href,
      user_agent: navigator.userAgent,
    };
    if (fd.get('email')) payload.email = fd.get('email');
    if (fd.get('website')) payload.website = fd.get('website');

    try {
      const res = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        status.textContent = `Thanks! Reference: ${data.id}`;
        setTimeout(() => { dialog.close(); dialog.remove(); }, 1800);
      } else if (res.status === 429) {
        status.textContent = 'Too many submissions; please try again later.';
        submitBtn.disabled = false;
      } else if (res.status === 400) {
        const data = await res.json().catch(() => ({}));
        status.textContent = data.detail || 'Validation error.';
        submitBtn.disabled = false;
      } else {
        status.textContent = 'Could not submit feedback. Please try again.';
        submitBtn.disabled = false;
      }
    } catch {
      status.textContent = 'Network error. Please check your connection.';
      submitBtn.disabled = false;
    }
  });
}

initFeedbackWidget();