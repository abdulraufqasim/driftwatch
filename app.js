const navItems = document.querySelectorAll('[data-view]');
const sections = document.querySelectorAll('.page-section');
const scanOverlay = document.getElementById('scan-overlay');
const scanButton = document.getElementById('scan-button');
const closeScan = document.getElementById('close-scan');
const progressBar = document.getElementById('progress-bar');
const progressLabel = document.getElementById('progress-label');
const progressPercent = document.getElementById('progress-percent');
const progressTrack = document.querySelector('.progress-track');
const scanSteps = [...document.querySelectorAll('.scan-step')];
const scanWaitNote = document.getElementById('scan-wait-note');
const retryScanButton = document.getElementById('retry-scan');
const searchInput = document.getElementById('repo-search');
const onboarding = document.getElementById('onboarding');
const appShell = document.getElementById('app-shell');
const repoForm = document.getElementById('repo-form');
const repoUrlInput = document.getElementById('repo-url');
const sampleButton = document.getElementById('sample-button');
const onboardingScanButton = document.getElementById('onboarding-scan');
const dashboardRepoForm = document.getElementById('dashboard-repo-form');
const dashboardRepoUrlInput = document.getElementById('dashboard-repo-url');
const dashboardScanButton = document.getElementById('dashboard-scan-button');
const dashboardDemoButton = document.getElementById('dashboard-demo-button');
const loadHistoryButton = document.getElementById('load-history-button');
const loadDashboardHistoryButton = document.getElementById('load-dashboard-history');
const githubConnectButton = document.getElementById('github-connect');
const githubConnected = document.getElementById('github-connected');
const githubLogin = document.getElementById('github-login');
const githubSwitchButton = document.getElementById('github-switch');
const githubMessage = document.getElementById('github-message');
const githubRepoPicker = document.getElementById('github-repo-picker');
const githubRepoSearch = document.getElementById('github-repo-search');
const githubRepoList = document.getElementById('github-repo-list');
const githubRepoEmpty = document.getElementById('github-repo-empty');
const githubSelection = document.getElementById('github-selection');
const githubDisconnectButton = document.getElementById('github-disconnect');
const githubSettingsStatus = document.getElementById('github-settings-status');
const githubSettingsMessage = document.getElementById('github-settings-message');
const scanError = document.getElementById('scan-error');
const scanDialogDescription = document.getElementById('scan-dialog-description');
const mapCanvas = document.querySelector('.architecture-canvas');
const mapZoomLevel = document.getElementById('map-zoom-level');
const themeToggles = [...document.querySelectorAll('[data-theme-toggle]')];
const brandLogos = [...document.querySelectorAll('.brand-logo, .onboarding-brand img')];
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarBackdrop = document.querySelector('.sidebar-backdrop');
const mobileSidebarQuery = window.matchMedia('(max-width: 700px)');
const panelMenuToggles = [...document.querySelectorAll('.more-button')];
const exportCsvButton = document.getElementById('export-csv');
const driftChatTrigger = document.getElementById('drift-chat-trigger');
const driftChatPanel = document.getElementById('drift-chat-panel');
const driftChatCloseButton = document.getElementById('drift-chat-close');
const driftChatClearButton = document.getElementById('drift-chat-clear');
const driftChatVoiceToggle = document.getElementById('drift-chat-voice-toggle');
const driftChatStopSpeakingButton = document.getElementById('drift-chat-stop-speaking');
const driftChatSuggestions = document.getElementById('drift-chat-suggestions');
const driftChatMessages = document.getElementById('drift-chat-messages');
const driftChatStatus = document.getElementById('drift-chat-status');
const driftChatForm = document.getElementById('drift-chat-form');
const driftChatInput = document.getElementById('drift-chat-input');
const driftChatSendButton = document.getElementById('drift-chat-send');
const driftChatMicButton = document.getElementById('drift-chat-mic');
const driftChatCancelVoiceButton = document.getElementById('drift-chat-cancel-voice');
const driftChatLanguage = document.getElementById('drift-chat-language');
const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;
const supportsSpeechSynthesis = 'speechSynthesis' in window
  && typeof window.SpeechSynthesisUtterance === 'function';
let mapZoom = 100;
let isSidebarOpen = !mobileSidebarQuery.matches;
let githubRepositories = [];
let selectedRepository = null;
let currentScan = null;
let currentScanDate = '';
let currentScanUrl = '';
let currentIsDemo = false;
let currentHistory = null;
let activeScanRun = null;
let retryScanOptions = null;
let chatBusy = false;
let chatGeneration = 0;
let chatRequestController = null;
let activeRecognition = null;
let voiceTranscript = '';
let voiceRecognitionError = '';
let voiceOutputEnabled = window.localStorage.getItem('driftwatch-dr-drift-voice') === 'true';
let currentUtterance = null;
const API_BASE_URL = (window.DRIFTWATCH_API_BASE || '').replace(/\/+$/, '');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function setSidebarOpen(isOpen) {
  isSidebarOpen = isOpen;
  appShell.classList.toggle('sidebar-open', isSidebarOpen);
  sidebarToggle.setAttribute('aria-expanded', String(isSidebarOpen));
  sidebarToggle.setAttribute('aria-label', `${isSidebarOpen ? 'Collapse' : 'Expand'} navigation`);
  sidebarToggle.setAttribute('title', `${isSidebarOpen ? 'Collapse' : 'Expand'} navigation`);
  if (!isSidebarOpen && sidebar.contains(document.activeElement)) sidebarToggle.focus();
  sidebar.inert = !isSidebarOpen;
  sidebar.setAttribute('aria-hidden', String(!isSidebarOpen));
  sidebarBackdrop.hidden = !mobileSidebarQuery.matches || !isSidebarOpen;
}

setSidebarOpen(isSidebarOpen);
sidebarToggle.addEventListener('click', () => setSidebarOpen(!isSidebarOpen));
sidebarBackdrop.addEventListener('click', () => setSidebarOpen(false));
mobileSidebarQuery.addEventListener('change', (event) => setSidebarOpen(!event.matches));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !driftChatPanel.hidden) {
    closeDriftChat(true);
    return;
  }
  if (event.key === 'Escape' && isSidebarOpen && mobileSidebarQuery.matches) {
    setSidebarOpen(false);
    sidebarToggle.focus();
  }
});

function setTheme(theme) {
  const isLight = theme === 'light';
  document.documentElement.dataset.theme = isLight ? 'light' : 'dark';
  window.localStorage.setItem('driftwatch-theme', isLight ? 'light' : 'dark');
  themeToggles.forEach((button) => {
    button.setAttribute('aria-label', `Switch to ${isLight ? 'dark' : 'light'} mode`);
    button.setAttribute('title', `Switch to ${isLight ? 'dark' : 'light'} mode`);
    button.setAttribute('aria-pressed', String(isLight));
  });
  brandLogos.forEach((logo) => {
    logo.src = isLight ? 'drift-logo.png' : 'drift-logo-dark.png';
    logo.srcset = isLight
      ? 'drift-logo.png 1x, drift-logo.png 2x'
      : 'drift-logo-dark.png 1x, drift-logo-dark@2x.png 2x';
  });
}

setTheme(window.localStorage.getItem('driftwatch-theme') === 'light' ? 'light' : 'dark');
themeToggles.forEach((button) => {
  button.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  });
});

function showView(viewName) {
  closePanelMenus(true);
  sections.forEach((section) => {
    section.classList.toggle('active-view', section.id === `${viewName}-view`);
  });
  document.querySelectorAll('.nav-item').forEach((item) => {
    const isActive = item.dataset.view === viewName;
    item.classList.toggle('active', isActive);
    if (isActive) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closePanelMenus(restoreFocus = false) {
  panelMenuToggles.forEach((button) => {
    const menu = document.getElementById(button.getAttribute('aria-controls'));
    const wasOpen = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
    if (restoreFocus && wasOpen && menu.contains(document.activeElement)) button.focus();
  });
}

navItems.forEach((item) => {
  item.addEventListener('click', () => {
    showView(item.dataset.view);
    if (mobileSidebarQuery.matches) setSidebarOpen(false);
  });
});

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.textContent = message;
  document.body.append(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  window.setTimeout(() => {
    toast.classList.remove('visible');
    window.setTimeout(() => toast.remove(), 220);
  }, 2600);
}

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim().toLowerCase();
  document.querySelectorAll('#activity-rows .table-row').forEach((row) => {
    row.hidden = query && !row.textContent.toLowerCase().includes(query);
  });
});

function resetScan() {
  document.getElementById('scan-dialog-heading').firstChild.textContent = 'Scanning repository';
  closeScan.disabled = false;
  progressTrack.classList.remove('is-pulsing');
  progressBar.style.width = '0%';
  progressTrack.setAttribute('aria-valuenow', '0');
  progressLabel.textContent = 'Waiting to start...';
  progressPercent.textContent = '0%';
  scanWaitNote.hidden = true;
  retryScanButton.hidden = true;
  scanError.hidden = true;
  scanError.textContent = '';
  scanSteps.forEach((step, index) => {
    step.classList.toggle('active', index === 0);
    step.classList.remove('done');
    step.classList.remove('failed');
    step.querySelector('i').textContent = '○';
  });
}

function setScanProgress(progress) {
  const value = Math.max(0, Math.min(100, progress));
  progressBar.style.width = `${value}%`;
  progressTrack.setAttribute('aria-valuenow', String(Math.round(value)));
  const roundedValue = Math.round(value);
  if (progressPercent.textContent !== `${roundedValue}%`) {
    progressPercent.textContent = `${roundedValue}%`;
  }
  progressTrack.classList.toggle('is-pulsing', value >= 90 && value < 100);
}

function setScanStep(run, activeIndex, failed = false) {
  run.currentStep = activeIndex;
  const activeStep = scanSteps[activeIndex];
  progressLabel.textContent = activeStep.dataset.step;
  scanSteps.forEach((step, index) => {
    const isFailed = failed && index === activeIndex;
    step.classList.toggle('active', index === activeIndex && !isFailed);
    step.classList.toggle('done', index < activeIndex);
    step.classList.toggle('failed', isFailed);
    step.querySelector('i').textContent = isFailed ? '×' : index < activeIndex ? '✓' : '○';
  });
}

function stopScanProgress(run) {
  if (run.frameId) window.cancelAnimationFrame(run.frameId);
  run.frameId = null;
  run.progressTimers.forEach((timer) => window.clearTimeout(timer));
  run.progressTimers = [];
  if (run.waitNoteTimer) window.clearTimeout(run.waitNoteTimer);
  run.waitNoteTimer = null;
  if (run.timeoutTimer) window.clearTimeout(run.timeoutTimer);
  run.timeoutTimer = null;
  if (run.completionWaitTimer) window.clearTimeout(run.completionWaitTimer);
  run.completionWaitTimer = null;
  if (run.completionWaitResolve) {
    run.completionWaitResolve(false);
    run.completionWaitResolve = null;
  }
}

function waitForDemoMinimumDuration(run) {
  const remaining = 900 - (Date.now() - run.startedAt);
  if (remaining <= 0) return Promise.resolve(!run.cancelled);
  return new Promise((resolve) => {
    run.completionWaitResolve = resolve;
    run.completionWaitTimer = window.setTimeout(() => {
      run.completionWaitTimer = null;
      run.completionWaitResolve = null;
      resolve(!run.cancelled && activeScanRun === run);
    }, remaining);
  });
}

function updatePendingScanProgress(run) {
  if (activeScanRun !== run || run.cancelled || run.timedOut) return;
  const elapsed = Date.now() - run.startedAt;
  const stageTimes = run.demo ? [250, 500, 750] : [1500, 4000, 8000];
  let activeIndex = 0;
  stageTimes.forEach((time, index) => {
    if (elapsed >= time) activeIndex = index + 1;
  });
  if (activeIndex > run.currentStep) setScanStep(run, activeIndex);

  if (prefersReducedMotion.matches) {
    setScanProgress(run.currentStep * 25);
    return;
  }
  setScanProgress(Math.min(90, (elapsed / 20000) * 90));
  run.frameId = window.requestAnimationFrame(() => updatePendingScanProgress(run));
}

function finishScanProgress(run) {
  stopScanProgress(run);
  scanWaitNote.hidden = true;

  if (prefersReducedMotion.matches) {
    setScanStep(run, scanSteps.length - 1);
    setScanProgress(100);
    progressLabel.textContent = 'Scan complete';
    return Promise.resolve(!run.cancelled);
  }

  return new Promise((resolve) => {
    run.resolveCompletion = resolve;
    const startedAt = performance.now();
    const duration = 360;
    const initialProgress = Number.parseFloat(progressBar.style.width) || 0;
    const initialStep = run.currentStep;
    const remainingSteps = scanSteps.length - 1 - initialStep;
    const advance = (now) => {
      if (run.cancelled || activeScanRun !== run) {
        run.resolveCompletion = null;
        resolve(false);
        return;
      }
      const progress = Math.min(1, (now - startedAt) / duration);
      const activeIndex = initialStep + Math.floor(progress * remainingSteps);
      setScanStep(run, Math.min(scanSteps.length - 1, activeIndex));
      setScanProgress(initialProgress + (100 - initialProgress) * progress);
      if (progress < 1) {
        run.frameId = window.requestAnimationFrame(advance);
        return;
      }
      setScanStep(run, scanSteps.length - 1);
      setScanProgress(100);
      progressLabel.textContent = 'Scan complete';
      run.frameId = null;
      run.resolveCompletion = null;
      resolve(true);
    };
    run.frameId = window.requestAnimationFrame(advance);
  });
}

function setPublicScanMessage(message, isError = false) {
  for (const id of ['github-message', 'dashboard-scan-message']) {
    const element = document.getElementById(id);
    element.textContent = message;
    element.hidden = !message;
    element.classList.toggle('is-error', isError);
    element.classList.toggle('is-success', Boolean(message) && !isError);
  }
}

function publicApiError(body, status) {
  if (body.code === 'invalid_repository_url' || status === 400) {
    return 'Invalid URL. Enter a public GitHub URL like https://github.com/owner/repository.';
  }
  if (body.code === 'repository_not_found' || body.code === 'branch_not_found' || status === 404) {
    return 'Repository not found, or it has no accessible commits. Check the URL and try again.';
  }
  if (body.code === 'github_rate_limited' || body.code === 'rate_limit' || body.code === 'rate_limit_exceeded' || status === 429
      || (status === 403 && /rate limit/i.test(body.error || ''))) {
    return 'GitHub API rate limit reached. Please wait and try again.';
  }
  return body.error || 'The repository scan could not be completed. Please try again.';
}

async function postPublicJson(endpoint, payload, { signal } = {}) {
  let response;
  try {
    response = await fetch(apiUrl(endpoint), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });
  } catch (error) {
    if (signal && signal.aborted) throw error;
    throw new Error('Unable to reach the Driftwatch server. Check your connection and try again.');
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('The Driftwatch server returned an invalid response.');
  }
  if (!response.ok) throw new Error(publicApiError(body, response.status));
  return body;
}

function setScanControlsDisabled(disabled) {
  onboardingScanButton.disabled = disabled;
  dashboardScanButton.disabled = disabled;
  dashboardDemoButton.disabled = disabled;
  sampleButton.disabled = disabled;
  scanButton.disabled = disabled;
  loadHistoryButton.disabled = disabled;
  loadDashboardHistoryButton.disabled = disabled;
}

async function runPublicScan({ demo = false, url = '' } = {}) {
  let scanUrl = url.trim();
  if (!demo) {
    try {
      const { owner, repo } = parsePublicRepositoryUrl(scanUrl);
      scanUrl = `https://github.com/${owner}/${repo}`;
    } catch (error) {
      setPublicScanMessage(error.message, true);
      return;
    }
  }

  const run = {
    controller: new AbortController(),
    startedAt: Date.now(),
    demo,
    currentStep: 0,
    cancelled: false,
    timedOut: false,
    frameId: null,
    progressTimers: [],
    waitNoteTimer: null,
    timeoutTimer: null,
    completionWaitTimer: null,
    completionWaitResolve: null,
    resolveCompletion: null
  };
  activeScanRun = run;
  retryScanOptions = null;
  setScanControlsDisabled(true);
  setPublicScanMessage(demo ? 'Loading the demo repository…' : 'Scanning public repository…');
  resetScan();
  scanDialogDescription.textContent = demo
    ? 'Analyzing the bundled demo repository.'
    : 'Downloading and analyzing the public repository archive.';
  scanOverlay.classList.add('visible');
  setScanStep(run, 0);
  updatePendingScanProgress(run);
  const stageTimes = demo ? [250, 500, 750] : [1500, 4000, 8000];
  run.progressTimers = stageTimes.map((time, index) => window.setTimeout(() => {
    if (activeScanRun === run && run.currentStep < index + 1) setScanStep(run, index + 1);
  }, time));
  if (!demo) {
    scanWaitNote.hidden = true;
    run.waitNoteTimer = window.setTimeout(() => {
      if (activeScanRun === run) scanWaitNote.hidden = false;
    }, 8000);
    run.timeoutTimer = window.setTimeout(() => {
      if (activeScanRun !== run) return;
      run.timedOut = true;
      run.controller.abort();
      stopScanProgress(run);
      setScanStep(run, run.currentStep, true);
      scanError.textContent = 'The scan timed out after 90 seconds. Retry when you are ready.';
      scanError.hidden = false;
      retryScanButton.hidden = false;
      retryScanOptions = { demo, url };
      setPublicScanMessage(scanError.textContent, true);
      activeScanRun = null;
      closeScan.disabled = false;
      setScanControlsDisabled(false);
    }, 90000);
  }
  try {
    const scan = await postPublicJson('/api/scan', demo ? { demo: true } : { url: scanUrl }, {
      signal: run.controller.signal
    });
    if (run.cancelled || activeScanRun !== run) return;
    if (demo && !await waitForDemoMinimumDuration(run)) return;
    stopScanProgress(run);
    if (!await finishScanProgress(run)) return;
    currentScan = scan;
    currentScanDate = new Date().toISOString();
    currentScanUrl = demo ? '' : scanUrl;
    currentIsDemo = demo;
    currentHistory = null;
    resetHistoryDisplay();
    applyPublicScan(scan);
    updateDriftChatWelcome();
    exportCsvButton.hidden = false;
    onboarding.classList.remove('visible');
    appShell.classList.add('ready');
    window.localStorage.setItem('driftwatch-onboarded', 'true');
    dashboardRepoUrlInput.value = currentScanUrl;
    repoUrlInput.value = currentScanUrl;
    setPublicScanMessage(`${scan.repo} scanned successfully.`, false);
    window.setTimeout(() => scanOverlay.classList.remove('visible'), 450);
    if (demo) await loadRepositoryHistory(true);
  } catch (error) {
    if (run.cancelled || run.timedOut || activeScanRun !== run) return;
    stopScanProgress(run);
    setScanStep(run, run.currentStep, true);
    scanError.textContent = error.message;
    scanError.hidden = false;
    setPublicScanMessage(error.message, true);
    if (!appShell.classList.contains('ready')) onboarding.classList.add('visible');
  } finally {
    if (activeScanRun === run) {
      stopScanProgress(run);
      activeScanRun = null;
      closeScan.disabled = false;
      setScanControlsDisabled(false);
    }
  }
}

function cancelActiveScan() {
  const run = activeScanRun;
  if (run) {
    run.cancelled = true;
    run.controller.abort();
    stopScanProgress(run);
    if (run.resolveCompletion) {
      run.resolveCompletion(false);
      run.resolveCompletion = null;
    }
    activeScanRun = null;
    setScanControlsDisabled(false);
  }
  retryScanOptions = null;
  retryScanButton.hidden = true;
  scanWaitNote.hidden = true;
  closeScan.disabled = false;
}

async function scanCurrentRepository() {
  if (currentIsDemo) {
    await runPublicScan({ demo: true });
    return;
  }
  const url = dashboardRepoUrlInput.value.trim() || repoUrlInput.value.trim() || currentScanUrl;
  if (!url) {
    onboarding.classList.add('visible');
    appShell.classList.remove('ready');
    setPublicScanMessage('Enter a public GitHub repository URL to scan.', true);
    return;
  }
  await runPublicScan({ url });
}

scanButton.addEventListener('click', scanCurrentRepository);
function setGithubMessage(message, isError = true) {
  githubMessage.textContent = message;
  githubMessage.hidden = !message;
  githubMessage.classList.toggle('is-error', isError);
  githubMessage.classList.toggle('is-success', Boolean(message) && !isError);
}

function setGithubSettingsMessage(message, isError = true) {
  githubSettingsMessage.textContent = message;
  githubSettingsMessage.hidden = !message;
  githubSettingsMessage.classList.toggle('is-error', isError);
}

function setRepositorySelection(repository, source) {
  selectedRepository = repository ? { ...repository, source } : null;
  onboardingScanButton.disabled = !selectedRepository && !repoUrlInput.value.trim();
  githubSelection.replaceChildren();
  githubSelection.hidden = !selectedRepository;
  if (!selectedRepository) return;

  const name = document.createElement('strong');
  name.textContent = selectedRepository.full_name;
  const details = document.createElement('span');
  const updatedAt = new Date(selectedRepository.updated_at || '');
  const updatedText = Number.isNaN(updatedAt.getTime())
    ? ''
    : ` · Updated ${updatedAt.toLocaleDateString()}`;
  details.textContent = `Public${updatedText}`;
  githubSelection.append(name, details);
  setGithubMessage(`${selectedRepository.full_name} selected.`, false);
}

function updateGithubRepoList() {
  const query = githubRepoSearch.value.trim().toLowerCase();
  const visibleRepositories = githubRepositories.filter((repository) =>
    repository.full_name.toLowerCase().includes(query));
  githubRepoList.replaceChildren();
  visibleRepositories.forEach((repository) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'github-repo-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(selectedRepository?.id === repository.id));
    const name = document.createElement('strong');
    name.textContent = repository.full_name;
    const metadata = document.createElement('span');
    const updatedAt = new Date(repository.updated_at);
    metadata.textContent = `Public · Updated ${Number.isNaN(updatedAt.getTime()) ? 'date unavailable' : updatedAt.toLocaleDateString()}`;
    option.append(name, metadata);
    option.addEventListener('click', () => setRepositorySelection(repository, 'github'));
    githubRepoList.append(option);
  });
  githubRepoEmpty.hidden = visibleRepositories.length !== 0;
}

function formatRelativeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'date unavailable';
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function updateDriftChatControls() {
  const hasScan = Boolean(currentScan);
  driftChatInput.disabled = !hasScan || chatBusy;
  driftChatSendButton.disabled = !hasScan || chatBusy || Boolean(activeRecognition)
    || !driftChatInput.value.trim();
  driftChatMicButton.hidden = !SpeechRecognitionApi;
  driftChatMicButton.disabled = !hasScan || chatBusy || Boolean(activeRecognition);
  driftChatCancelVoiceButton.hidden = !activeRecognition;
  driftChatVoiceToggle.disabled = !supportsSpeechSynthesis;
  driftChatSuggestions.querySelectorAll('button').forEach((button) => {
    button.disabled = chatBusy || Boolean(activeRecognition);
  });
}

function setDriftChatStatus(message, isError = false) {
  driftChatStatus.textContent = message;
  driftChatStatus.classList.toggle('is-error', isError);
}

function appendDriftChatMessage(role, text, isError = false) {
  const message = createElement('div', `drift-chat-message ${role}${isError ? ' is-error' : ''}`, text);
  driftChatMessages.append(message);
  driftChatMessages.scrollTop = driftChatMessages.scrollHeight;
  return message;
}

function showDriftChatTyping() {
  const typing = document.createElement('div');
  typing.className = 'drift-chat-message drift-chat-typing';
  typing.setAttribute('role', 'status');
  typing.setAttribute('aria-label', 'Dr. Drift is typing');
  for (let index = 0; index < 3; index += 1) typing.append(document.createElement('span'));
  driftChatMessages.append(typing);
  driftChatMessages.scrollTop = driftChatMessages.scrollHeight;
  return typing;
}

function suggestedDriftQuestions() {
  if (!currentScan) return [];
  return [
    `Why is my score ${currentScan.healthScore}?`,
    'How do I fix the critical violations?',
    'Which layer has the most problems?',
    'Explain this architecture'
  ];
}

function updateDriftChatWelcome() {
  chatGeneration += 1;
  if (chatRequestController) chatRequestController.abort();
  chatRequestController = null;
  chatBusy = false;
  cancelDriftRecognition(false);
  stopDriftSpeaking();
  driftChatMessages.replaceChildren();
  driftChatSuggestions.replaceChildren();
  setDriftChatStatus('');
  appendDriftChatMessage(
    'assistant',
    currentScan
      ? 'Hi, I’m Dr. Drift. I can explain this scan and suggest practical architecture fixes.'
      : 'Hi, I’m Dr. Drift. Scan a repository or try the demo first, and I’ll help explain its architecture.'
  );
  suggestedDriftQuestions().forEach((question) => {
    const chip = createElement('button', 'drift-chat-suggestion', question);
    chip.type = 'button';
    chip.addEventListener('click', () => { void submitDriftQuestion(question); });
    driftChatSuggestions.append(chip);
  });
  updateDriftChatControls();
}

function openDriftChat() {
  driftChatPanel.hidden = false;
  driftChatTrigger.setAttribute('aria-expanded', 'true');
  window.requestAnimationFrame(() => {
    (driftChatInput.disabled ? driftChatCloseButton : driftChatInput).focus();
  });
}

function closeDriftChat(restoreFocus = false) {
  cancelDriftRecognition(false);
  stopDriftSpeaking();
  driftChatPanel.hidden = true;
  driftChatTrigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus) driftChatTrigger.focus();
}

function stopDriftSpeaking() {
  if (supportsSpeechSynthesis) window.speechSynthesis.cancel();
  currentUtterance = null;
  driftChatStopSpeakingButton.hidden = true;
}

function speechFriendlyText(reply) {
  return reply
    .replace(/```[\s\S]*?```/g, ' Code omitted. ')
    .replace(/`[^`]*`/g, ' code omitted ')
    .replace(/https?:\/\/\S+/gi, 'a link')
    .replace(/\b[A-Za-z]:[\\/](?:[\w .-]+[\\/])*[\w .-]+/g, 'a file path')
    .replace(/\b(?:[\w.-]+[\\/])+[\w.-]+\b/g, 'a file path')
    .slice(0, 700);
}

function speakDriftReply(reply) {
  if (!voiceOutputEnabled || !supportsSpeechSynthesis || driftChatPanel.hidden) return;
  const text = speechFriendlyText(reply).trim();
  if (!text) return;

  stopDriftSpeaking();
  const utterance = new window.SpeechSynthesisUtterance(text);
  const language = driftChatLanguage.value;
  const languagePrefix = language.split('-')[0].toLowerCase();
  const voice = window.speechSynthesis.getVoices()
    .find((candidate) => candidate.lang.toLowerCase().startsWith(languagePrefix));
  utterance.lang = language;
  if (voice) utterance.voice = voice;
  utterance.rate = 0.96;
  utterance.onstart = () => {
    if (currentUtterance === utterance) driftChatStopSpeakingButton.hidden = false;
  };
  utterance.onend = () => {
    if (currentUtterance === utterance) stopDriftSpeaking();
  };
  utterance.onerror = () => {
    if (currentUtterance === utterance) stopDriftSpeaking();
  };
  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

function cancelDriftRecognition(showStatus = true) {
  if (!activeRecognition) return;
  const recognition = activeRecognition;
  activeRecognition = null;
  voiceTranscript = '';
  voiceRecognitionError = 'aborted';
  try {
    recognition.abort();
  } catch (error) {
    if (error.name !== 'InvalidStateError') throw error;
  }
  driftChatMicButton.classList.remove('is-listening');
  updateDriftChatControls();
  if (showStatus) setDriftChatStatus('Voice input cancelled.');
}

function startDriftRecognition() {
  if (!SpeechRecognitionApi || !currentScan || chatBusy) return;
  stopDriftSpeaking();
  voiceTranscript = '';
  voiceRecognitionError = '';
  driftChatInput.value = '';
  setDriftChatStatus('Listening…');
  driftChatMicButton.classList.add('is-listening');
  try {
    const recognition = new SpeechRecognitionApi();
    recognition.lang = driftChatLanguage.value;
    recognition.continuous = false;
    recognition.interimResults = true;
    activeRecognition = recognition;
    recognition.onresult = (event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) voiceTranscript += `${result[0].transcript} `;
        else interim += result[0].transcript;
      }
      driftChatInput.value = `${voiceTranscript}${interim}`.trim();
      updateDriftChatControls();
    };
    recognition.onerror = (event) => {
      voiceRecognitionError = event.error || 'unknown';
      const errorMessages = {
        'not-allowed': 'Microphone access was denied. Allow microphone access in your browser settings and try again.',
        'service-not-allowed': 'Microphone access was denied. Allow microphone access in your browser settings and try again.',
        'no-speech': 'No speech was detected. Try again when you are ready.',
        network: 'Voice input could not connect to your browser’s speech service.'
      };
      setDriftChatStatus(errorMessages[voiceRecognitionError] || 'Voice input could not start. Please try again.', true);
    };
    recognition.onend = () => {
      if (activeRecognition !== recognition) return;
      activeRecognition = null;
      driftChatMicButton.classList.remove('is-listening');
      updateDriftChatControls();
      if (voiceRecognitionError) {
        if (voiceRecognitionError === 'no-speech') {
          setDriftChatStatus('No speech was detected. Try again when you are ready.', true);
        }
        return;
      }
      const question = voiceTranscript.trim();
      if (!question) {
        setDriftChatStatus('No speech was detected. Try again when you are ready.', true);
        return;
      }
      driftChatInput.value = question;
      void submitDriftQuestion(question);
    };
    recognition.start();
    updateDriftChatControls();
  } catch (error) {
    activeRecognition = null;
    driftChatMicButton.classList.remove('is-listening');
    updateDriftChatControls();
    setDriftChatStatus(
      error.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow microphone access in your browser settings and try again.'
        : 'Voice input could not start. Please try again.',
      true
    );
  }
}

function scanSummaryForDriftChat() {
  const scan = {
    repo: currentScan.repo,
    branch: currentScan.branch,
    fileCount: currentScan.fileCount,
    layers: currentScan.layers,
    healthScore: currentScan.healthScore,
    summary: currentScan.summary,
    violations: currentScan.violations.slice(0, 50).map((violation) => ({
      ruleId: violation.ruleId,
      severity: violation.severity,
      message: violation.message,
      fromFile: violation.fromFile,
      toFile: violation.toFile,
      fromLayer: violation.fromLayer,
      toLayer: violation.toLayer
    }))
  };
  if (currentHistory && Array.isArray(currentHistory.points)) {
    scan.history = {
      points: currentHistory.points.slice(-20).map(({ sha, message, healthScore }) => ({
        sha: typeof sha === 'string' ? sha.slice(0, 40) : '',
        message: typeof message === 'string' ? message.slice(0, 300) : '',
        healthScore
      }))
    };
  }
  return scan;
}

async function submitDriftQuestion(value) {
  const question = value.trim();
  if (!currentScan || chatBusy || !question) return;
  if (question.length > 1000) {
    setDriftChatStatus('Keep your question under 1000 characters.', true);
    return;
  }

  cancelDriftRecognition(false);
  stopDriftSpeaking();
  setDriftChatStatus('');
  appendDriftChatMessage('user', question);
  driftChatInput.value = '';
  chatBusy = true;
  const generation = ++chatGeneration;
  const controller = new AbortController();
  chatRequestController = controller;
  const typing = showDriftChatTyping();
  updateDriftChatControls();
  try {
    const response = await fetch(apiUrl('/api/chat'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: question, scan: scanSummaryForDriftChat() }),
      signal: controller.signal
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('Dr. Drift returned an invalid response. Please try again.');
    }
    if (!response.ok) {
      throw new Error(response.status === 503 && result.error === 'Dr. Drift is not available right now'
        ? 'Dr. Drift is not available right now. Please try again later.'
        : result.error || 'Dr. Drift could not answer right now. Please try again.');
    }
    if (typeof result.reply !== 'string') throw new Error('Dr. Drift returned an invalid response. Please try again.');
    if (generation !== chatGeneration) return;
    appendDriftChatMessage('assistant', result.reply);
    speakDriftReply(result.reply);
  } catch (error) {
    if (controller.signal.aborted || generation !== chatGeneration) return;
    appendDriftChatMessage(
      'assistant',
      error instanceof TypeError
        ? 'Dr. Drift could not connect. Check your connection and try again.'
        : error.message,
      true
    );
  } finally {
    typing.remove();
    if (generation === chatGeneration) {
      chatRequestController = null;
      chatBusy = false;
      updateDriftChatControls();
    }
  }
}

driftChatTrigger.addEventListener('click', openDriftChat);
driftChatCloseButton.addEventListener('click', () => closeDriftChat(true));
driftChatClearButton.addEventListener('click', updateDriftChatWelcome);
driftChatVoiceToggle.setAttribute('aria-pressed', String(voiceOutputEnabled));
driftChatVoiceToggle.textContent = voiceOutputEnabled ? 'Voice on' : 'Voice off';
driftChatVoiceToggle.setAttribute('aria-label', `Turn voice replies ${voiceOutputEnabled ? 'off' : 'on'}`);
driftChatVoiceToggle.addEventListener('click', () => {
  voiceOutputEnabled = !voiceOutputEnabled;
  window.localStorage.setItem('driftwatch-dr-drift-voice', String(voiceOutputEnabled));
  driftChatVoiceToggle.setAttribute('aria-pressed', String(voiceOutputEnabled));
  driftChatVoiceToggle.textContent = voiceOutputEnabled ? 'Voice on' : 'Voice off';
  driftChatVoiceToggle.setAttribute('aria-label', `Turn voice replies ${voiceOutputEnabled ? 'off' : 'on'}`);
  if (!voiceOutputEnabled) stopDriftSpeaking();
});
driftChatStopSpeakingButton.addEventListener('click', stopDriftSpeaking);
driftChatMicButton.addEventListener('click', startDriftRecognition);
driftChatCancelVoiceButton.addEventListener('click', () => cancelDriftRecognition(true));
driftChatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitDriftQuestion(driftChatInput.value);
});
driftChatInput.addEventListener('input', updateDriftChatControls);
updateDriftChatWelcome();

function layerName(layer) {
  if (layer === 'services' || layer === 'service') return 'services';
  if (layer === 'shared') return 'other';
  return layer || 'other';
}

function layerChipClass(layer) {
  if (layer === 'database') return 'data';
  return layer === 'services' ? 'service' : layer === 'other' ? 'shared' : layer;
}

function renderPublicRepositoryTree(scan) {
  const entries = document.getElementById('repository-tree-entries');
  const manifests = document.getElementById('repository-manifests');
  entries.replaceChildren();
  manifests.replaceChildren();
  const topEntries = new Map();
  const folders = new Set();
  for (const file of scan.files) {
    const parts = file.path.split('/');
    if (parts.length > 1) {
      topEntries.set(parts[0], true);
      for (let index = 1; index < parts.length; index += 1) {
        folders.add(parts.slice(0, index).join('/'));
      }
    } else {
      topEntries.set(file.path, false);
    }
  }
  [...topEntries.entries()].slice(0, 7).forEach(([name, isFolder], index, list) => {
    const row = createElement('div', 'tree-line');
    row.append(createElement('span', 'tree-branch', index === list.length - 1 ? '└' : '├'));
    row.append(createElement('span', `folder-mini ${isFolder ? 'blue' : 'purple'}`, isFolder ? '▰' : '·'));
    row.append(createElement('span', '', isFolder ? `${name}/` : name));
    if (isFolder) {
      const layer = scan.files.find((file) => file.path.startsWith(`${name}/`))?.layer || 'other';
      row.append(createElement('span', `layer-chip ${layerChipClass(layerName(layer))}`, `${layerName(layer)} layer`));
    }
    entries.append(row);
  });
  if (!topEntries.size) entries.append(createElement('p', 'empty-state', 'No source files were found.'));
  const root = document.getElementById('repository-tree-root');
  root.querySelector('strong').textContent = `${scan.repo}/`;
  root.querySelector('.tree-meta').textContent = `${scan.branch} · scanned ${formatRelativeDate(new Date().toISOString())}`;
  document.getElementById('repository-file-count').textContent = scan.fileCount.toLocaleString();
  document.getElementById('repository-folder-count').textContent = folders.size.toLocaleString();
  document.getElementById('repository-layer-count').textContent =
    Object.values(scan.layers).filter((count) => count > 0).length.toLocaleString();
  const breakdown = document.getElementById('repository-layer-breakdown');
  breakdown.replaceChildren();
  for (const [layer, count] of Object.entries(scan.layers)) {
    if (!count) continue;
    breakdown.append(createElement('span', `layer-chip ${layerChipClass(layerName(layer))}`, `${layer}: ${count.toLocaleString()}`));
  }
}

function renderPublicArchitecture(scan) {
  const canvas = document.getElementById('generated-map-content');
  canvas.replaceChildren();
  const layerOrder = ['frontend', 'backend', 'services', 'database', 'other'];
  const layerLabels = { frontend: 'Frontend', backend: 'Backend', services: 'Services', database: 'Database', other: 'Shared / other' };
  const columnCenters = [110, 330, 550, 770, 990];
  const groups = new Map(layerOrder.map((layer) => [layer, []]));
  for (const file of scan.files) {
    const layer = layerName(file.layer);
    if (!groups.has(layer)) groups.set(layer, []);
    groups.get(layer).push(file);
  }
  const positions = new Map();
  let maxFilesInLayer = 0;
  for (const [layer, files] of groups) {
    maxFilesInLayer = Math.max(maxFilesInLayer, files.length);
    files.forEach((file, index) => {
      positions.set(file.path, { x: columnCenters[layerOrder.indexOf(layer)] ?? columnCenters[4], y: 82 + index * 78 });
    });
  }
  const activeLayers = [...groups.values()].filter((files) => files.length).length;
  const height = Math.max(560, 145 + Math.max(0, maxFilesInLayer - 1) * 78);
  mapCanvas.style.height = `${Math.min(height, 850)}px`;
  canvas.style.height = `${height}px`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'connections');
  svg.setAttribute('viewBox', `0 0 1100 ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  for (const [id, color] of [['generated-arrow', 'var(--accent)'], ['generated-arrow-red', 'var(--red)']]) {
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', id);
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX', '6');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrow.setAttribute('d', 'M0,0 L0,6 L6,3 z');
    arrow.setAttribute('fill', color);
    marker.append(arrow);
    defs.append(marker);
  }
  svg.append(defs);
  const violationEdges = new Set(scan.violations.map((violation) => `${violation.fromFile}\0${violation.toFile}`));
  for (const dependency of scan.dependencies) {
    const from = positions.get(dependency.from);
    const to = positions.get(dependency.to);
    if (!from || !to) continue;
    const forward = to.x >= from.x;
    const startX = from.x + (forward ? 85 : -85);
    const endX = to.x - (forward ? 85 : -85);
    const middle = (startX + endX) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const isViolation = violationEdges.has(`${dependency.from}\0${dependency.to}`);
    path.setAttribute('d', `M${startX} ${from.y} C${middle} ${from.y}, ${middle} ${to.y}, ${endX} ${to.y}`);
    path.setAttribute('marker-end', `url(#${isViolation ? 'generated-arrow-red' : 'generated-arrow'})`);
    path.setAttribute('aria-label', `${dependency.from} depends on ${dependency.to}${isViolation ? ', architecture violation' : ''}`);
    path.dataset.from = dependency.from;
    path.dataset.to = dependency.to;
    if (isViolation) path.classList.add('violation-edge');
    svg.append(path);
  }
  canvas.append(svg);
  for (const [layer, files] of groups) {
    if (!files.length) continue;
    const heading = createElement('strong', 'map-layer-title', layer === 'other' ? 'Shared / other' : layer);
    heading.style.left = `${(columnCenters[layerOrder.indexOf(layer)] / 1100) * 100}%`;
    canvas.append(heading);
  }
  const icons = { frontend: '◇', backend: '⇄', services: '●', database: '▤', other: '⌘' };
  const iconClasses = { frontend: 'blue-icon', backend: 'indigo-icon', services: 'green-icon', database: 'purple-icon', other: 'blue-icon' };
  for (const [layer, files] of groups) {
    files.forEach((file) => {
      const position = positions.get(file.path);
      const nodeLayerClass = layer === 'services' ? 'service' : layer === 'other' ? 'shared' : layer;
      const node = createElement('div', `map-node generated-node ${nodeLayerClass}-node`);
      node.dataset.layer = layer;
      node.style.left = `${(position.x / 1100) * 100}%`;
      node.style.top = `${position.y}px`;
      const [icon, iconClass] = [icons[layer] || '●', iconClasses[layer] || 'green-icon'];
      node.append(createElement('span', `node-icon ${iconClass}`, icon));
      const description = createElement('div');
      description.append(createElement('strong', '', file.path.split('/').pop()));
      description.append(createElement('small', '', `${file.path} · ${layerLabels[layer] || layer}`));
      node.title = file.path;
      node.append(description);
      canvas.append(node);
    });
  }
  document.getElementById('map-summary').textContent =
    `${scan.fileCount.toLocaleString()} files · ${activeLayers} layers · ${scan.dependencies.length.toLocaleString()} dependencies · ${scan.violations.length.toLocaleString()} violations`;
  document.getElementById('map-repository-name').textContent = `${scan.repo} · ${scan.branch}`;
}

function renderPublicViolations(scan) {
  const cards = document.getElementById('violation-cards');
  const observations = document.getElementById('structure-observations');
  cards.replaceChildren();
  observations.replaceChildren();
  const violationBadge = document.getElementById('violation-count');
  violationBadge.textContent = scan.violations.length.toLocaleString();
  violationBadge.hidden = scan.violations.length === 0;
  document.getElementById('drift-title').textContent = `${scan.violations.length.toLocaleString()} violations`;
  if (!scan.violations.length) {
    const empty = createElement('p', 'empty-state', 'No architecture violations were found in this scan.');
    cards.append(empty.cloneNode(true));
    observations.append(empty);
    return;
  }
  for (const violation of scan.violations) {
    const card = createElement('article', 'violation-card panel');
    const top = createElement('div', 'violation-top');
    top.append(createElement('span', 'warning-badge', violation.severity.toUpperCase()));
    top.append(createElement('span', 'mono muted', violation.ruleId));
    card.append(top);
    card.append(createElement('h3', '', `${violation.fromFile} → ${violation.toFile}`));
    card.append(createElement('p', '', violation.message));
    const footer = createElement('div', 'violation-footer');
    footer.append(createElement('span', '', `${violation.fromLayer} → ${violation.toLayer}`));
    footer.append(createElement('span', 'rule-id', violation.ruleId));
    card.append(footer);
    cards.append(card);
    const signal = createElement('div', 'signal-item');
    signal.append(createElement('span', `signal-icon ${violation.severity === 'critical' ? 'red' : 'amber'}`, '↗'));
    const detail = createElement('div');
    detail.append(createElement('strong', '', `${violation.fromFile} → ${violation.toFile}`));
    detail.append(createElement('small', '', `${violation.ruleId} · ${violation.message}`));
    signal.append(detail);
    observations.append(signal);
  }
}

function applyPublicScan(scan) {
  if (!scan || typeof scan.repo !== 'string' || !Array.isArray(scan.files)
      || !Array.isArray(scan.dependencies) || !Array.isArray(scan.violations) || !scan.summary) {
    throw new Error('The scan returned incomplete repository data.');
  }
  const repositoryName = scan.repo;
  const repositoryShortName = repositoryName.split('/').pop();
  const repositoryOwner = repositoryName.includes('/') ? repositoryName.split('/')[0] : 'Demo';
  const scannedAt = new Date(currentScanDate || Date.now());
  document.getElementById('repository-name').textContent = repositoryName;
  document.getElementById('workspace-name').textContent = repositoryShortName;
  document.getElementById('workspace-avatar').textContent = repositoryShortName.slice(0, 1).toUpperCase();
  document.getElementById('repository-owner-name').textContent = repositoryOwner;
  document.getElementById('repository-owner-avatar').textContent = repositoryOwner.slice(0, 2).toUpperCase();
  document.getElementById('workspace-repository-name').textContent = repositoryShortName;
  document.getElementById('guardian-status').textContent = 'Scan complete';
  document.getElementById('guardian-last-scan').textContent = `Last scan ${formatRelativeDate(scannedAt.toISOString())}`;
  document.getElementById('topbar-scan-state').lastChild.textContent = ` Scanned ${formatRelativeDate(scannedAt.toISOString())}`;
  document.querySelector('.live-dot').hidden = true;
  document.getElementById('scan-date').textContent = `Repository overview · ${scannedAt.toLocaleString()}`;
  document.getElementById('health-title').textContent = 'Architecture health';
  document.getElementById('health-score').textContent = scan.healthScore.toLocaleString();
  document.getElementById('health-ring').style.setProperty('--score', String(scan.healthScore));
  document.getElementById('structure-badge').lastChild.textContent =
    ` ${scan.summary.healthy.toLocaleString()} healthy dependencies`;
  document.getElementById('health-summary').textContent =
    `${scan.fileCount.toLocaleString()} files across ${Object.values(scan.layers).filter((count) => count > 0).length.toLocaleString()} layers in ${repositoryName} (${scan.branch}).`;
  document.getElementById('cross-layer-summary').textContent = `${scan.dependencies.length.toLocaleString()} dependencies`;
  document.getElementById('scan-timestamp').textContent = scannedAt.toLocaleTimeString();
  document.getElementById('healthy-count').textContent = `${scan.summary.healthy.toLocaleString()} healthy`;
  document.getElementById('warning-count').textContent = `${scan.summary.warnings.toLocaleString()} warnings`;
  document.getElementById('critical-count').textContent = `${scan.summary.critical.toLocaleString()} critical`;
  document.getElementById('timeline-file-count').textContent = scan.fileCount.toLocaleString();
  document.getElementById('timeline-module-count').textContent =
    Object.values(scan.layers).filter((count) => count > 0).length.toLocaleString();
  document.getElementById('repository-manifests').replaceChildren();
  renderPublicRepositoryTree(scan);
  renderPublicArchitecture(scan);
  renderPublicViolations(scan);
}

function renderHealthChart(container, history) {
  container.replaceChildren();
  if (!history.points.length) {
    container.append(createElement('p', 'empty-state', 'No commit health points were returned.'));
    return;
  }
  const width = 800;
  const height = 260;
  const left = 48;
  const right = 24;
  const top = 18;
  const bottom = 38;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index) => history.points.length === 1
    ? left + plotWidth / 2
    : left + (index / (history.points.length - 1)) * plotWidth;
  const y = (score) => top + ((100 - score) / 100) * plotHeight;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'health-history-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Health score history for ${history.repo}`);
  for (const score of [0, 50, 100]) {
    const grid = document.createElementNS(svg.namespaceURI, 'line');
    grid.setAttribute('x1', String(left));
    grid.setAttribute('x2', String(width - right));
    grid.setAttribute('y1', String(y(score)));
    grid.setAttribute('y2', String(y(score)));
    grid.setAttribute('class', 'history-grid-line');
    svg.append(grid);
    const label = document.createElementNS(svg.namespaceURI, 'text');
    label.setAttribute('x', '2');
    label.setAttribute('y', String(y(score) + 4));
    label.setAttribute('class', 'history-axis-label');
    label.textContent = String(score);
    svg.append(label);
  }
  const points = history.points.map((point, index) => `${x(index)},${y(point.healthScore)}`);
  const line = document.createElementNS(svg.namespaceURI, 'polyline');
  line.setAttribute('points', points.join(' '));
  line.setAttribute('class', 'history-score-line');
  svg.append(line);
  const firstDriftIndex = history.firstDriftCommit
    ? history.points.findIndex((point) => point.sha === history.firstDriftCommit.sha)
    : -1;
  if (firstDriftIndex >= 0) {
    const marker = document.createElementNS(svg.namespaceURI, 'line');
    marker.setAttribute('x1', String(x(firstDriftIndex)));
    marker.setAttribute('x2', String(x(firstDriftIndex)));
    marker.setAttribute('y1', String(top));
    marker.setAttribute('y2', String(height - bottom));
    marker.setAttribute('class', 'history-drift-marker');
    svg.append(marker);
    const label = document.createElementNS(svg.namespaceURI, 'text');
    label.setAttribute('x', String(Math.min(x(firstDriftIndex) + 6, width - 150)));
    label.setAttribute('y', String(top + 12));
    label.setAttribute('class', 'history-drift-label');
    label.textContent = 'First drift';
    svg.append(label);
  }
  history.points.forEach((point, index) => {
    const dot = document.createElementNS(svg.namespaceURI, 'circle');
    dot.setAttribute('cx', String(x(index)));
    dot.setAttribute('cy', String(y(point.healthScore)));
    dot.setAttribute('r', firstDriftIndex === index ? '6' : '4');
    dot.setAttribute('class', firstDriftIndex === index ? 'history-point history-point-drift' : 'history-point');
    const title = document.createElementNS(svg.namespaceURI, 'title');
    title.textContent = `${point.message} · ${point.healthScore} health`;
    dot.append(title);
    svg.append(dot);
  });
  const firstLabel = document.createElementNS(svg.namespaceURI, 'text');
  firstLabel.setAttribute('x', String(left));
  firstLabel.setAttribute('y', String(height - 8));
  firstLabel.setAttribute('class', 'history-axis-label');
  firstLabel.textContent = history.points[0].sha.slice(0, 7);
  svg.append(firstLabel);
  const lastLabel = document.createElementNS(svg.namespaceURI, 'text');
  lastLabel.setAttribute('x', String(width - right));
  lastLabel.setAttribute('y', String(height - 8));
  lastLabel.setAttribute('text-anchor', 'end');
  lastLabel.setAttribute('class', 'history-axis-label');
  lastLabel.textContent = history.points.at(-1).sha.slice(0, 7);
  svg.append(lastLabel);
  container.append(svg);
}

async function loadRepositoryHistory(demo = currentIsDemo) {
  if (!currentScan) {
    const message = 'Scan a repository before loading its history.';
    document.getElementById('dashboard-history-status').textContent = message;
    document.getElementById('timeline-history-status').textContent = message;
    return;
  }
  if (currentHistory) return;
  loadHistoryButton.disabled = true;
  loadDashboardHistoryButton.disabled = true;
  const statuses = [document.getElementById('dashboard-history-status'), document.getElementById('timeline-history-status')];
  statuses.forEach((status) => {
    status.textContent = 'Loading commit history and scanning health…';
    status.classList.remove('is-error');
  });
  try {
    const history = await postPublicJson('/api/history', demo ? { demo: true } : { url: currentScanUrl });
    if (!Array.isArray(history.points)) throw new Error('The history response did not contain commit health points.');
    currentHistory = history;
    document.getElementById('timeline-commit-count').textContent = history.points.length.toLocaleString();
    const driftText = history.firstDriftCommit
      ? `First drift: ${history.firstDriftCommit.message} (${history.firstDriftCommit.scoreDrop} point drop).`
      : 'No health-score drop was detected across these commits.';
    document.getElementById('repository-timeline-caption').textContent = driftText;
    renderHealthChart(document.getElementById('dashboard-history-chart'), history);
    renderHealthChart(document.getElementById('repository-timeline'), history);
    statuses.forEach((status) => {
      status.textContent = history.points.length
        ? `${history.points.length.toLocaleString()} commit health points · ${history.repo} · ${history.branch}`
        : 'No commit health points were returned.';
      status.classList.toggle('empty-state', history.points.length === 0);
    });
  } catch (error) {
    statuses.forEach((status) => {
      status.textContent = error.message;
      status.classList.add('is-error');
    });
  } finally {
    loadHistoryButton.disabled = false;
    loadDashboardHistoryButton.disabled = false;
  }
}

function resetHistoryDisplay() {
  document.getElementById('timeline-commit-count').textContent = '--';
  document.getElementById('repository-timeline-caption').textContent = '';
  document.getElementById('dashboard-history-chart').replaceChildren();
  document.getElementById('repository-timeline').replaceChildren();
  document.getElementById('dashboard-history-status').textContent = 'Load history to compare health scores across commits.';
  document.getElementById('timeline-history-status').textContent =
    'Load history to analyze health over time. This scan may take longer than a repository scan.';
  for (const id of ['dashboard-history-status', 'timeline-history-status']) {
    const status = document.getElementById(id);
    status.classList.remove('is-error');
    status.classList.add('empty-state');
  }
}

function renderLanguageChart(languages) {
  const chart = document.getElementById('language-chart');
  chart.replaceChildren();
  if (!languages.length) {
    chart.append(createElement('p', 'empty-state', 'No recognizable source languages were found.'));
    return;
  }
  const topLanguages = languages.slice(0, 6);
  const maxCount = Math.max(...topLanguages.map((language) => language.count));
  for (const language of topLanguages) {
    const row = createElement('div', 'language-row');
    const label = createElement('div', 'language-row-label');
    label.append(createElement('strong', '', language.name));
    label.append(createElement('span', '', `${language.count} files`));
    const track = createElement('div', 'language-bar-track');
    const bar = createElement('span', 'language-bar');
    bar.style.width = `${Math.max(3, (language.count / maxCount) * 100)}%`;
    track.append(bar);
    row.append(label, track);
    chart.append(row);
  }
}

function renderRepositoryTree(repository, analysis) {
  const root = document.getElementById('repository-tree-root');
  root.querySelector('strong').textContent = `${repository.full_name}/`;
  root.querySelector('.tree-meta').textContent = `${repository.default_branch} · scanned ${formatRelativeDate(new Date().toISOString())}`;
  const entries = document.getElementById('repository-tree-entries');
  entries.replaceChildren();
  const topFolders = [...new Set(analysis.folders.map((folder) => folder.split('/')[0]))];
  const topFiles = analysis.files.filter((file) => !file.includes('/')).slice(0, Math.max(0, 5 - topFolders.length));
  const visibleEntries = [
    ...topFolders.slice(0, 5).map((folder) => ({ name: `${folder}/`, path: folder, isFolder: true })),
    ...topFiles.map((file) => ({ name: file, path: file, isFolder: false }))
  ].slice(0, 7);
  visibleEntries.forEach((entry, index) => {
    const row = createElement('div', 'tree-line');
    row.append(createElement('span', 'tree-branch', index === visibleEntries.length - 1 ? '└' : '├'));
    row.append(createElement('span', `folder-mini ${entry.isFolder ? 'blue' : 'purple'}`, entry.isFolder ? '▰' : '·'));
    row.append(createElement('span', '', entry.name));
    if (entry.isFolder) {
      const module = analysis.modules.find((item) => item.id === entry.path);
      if (module) {
        const chipClass = module.layer === 'frontend' ? 'frontend'
          : module.layer === 'database' ? 'data'
            : module.layer === 'backend' ? 'backend' : 'service';
        row.append(createElement('span', `layer-chip ${chipClass}`, `${module.layer} layer`));
      }
    }
    entries.append(row);
  });
  if (!visibleEntries.length) entries.append(createElement('p', 'empty-state', 'No top-level files or folders were found.'));
  const manifestList = document.getElementById('repository-manifests');
  manifestList.replaceChildren();
  if (analysis.manifests.length) {
    manifestList.append(createElement('span', 'manifest-label', 'Dependency manifests'));
    analysis.manifests.slice(0, 5).forEach((manifest) => {
      manifestList.append(createElement('span', 'manifest-chip', `${manifest.path}${manifest.dependencyCount === null ? '' : ` · ${manifest.dependencyCount} dependencies`}`));
    });
  }
  document.getElementById('repository-file-count').textContent = analysis.fileCount.toLocaleString();
  document.getElementById('repository-folder-count').textContent = analysis.folderCount.toLocaleString();
  document.getElementById('repository-layer-count').textContent = new Set(analysis.modules.map((item) => item.layer)).size.toLocaleString();
}

function renderArchitectureMap(analysis) {
  const canvas = document.getElementById('generated-map-content');
  canvas.replaceChildren();
  const modules = analysis.modules;
  const edges = analysis.edges;
  const layerOrder = ['frontend', 'backend', 'service', 'shared', 'database'];
  const columnCenters = [130, 340, 550, 760, 970];
  const rowCounts = new Map();
  const positions = new Map();
  const groups = new Map();
  modules.forEach((module) => {
    const layerIndex = Math.max(0, layerOrder.indexOf(module.layer));
    if (!groups.has(module.layer)) groups.set(module.layer, []);
    groups.get(module.layer).push(module);
    const row = rowCounts.get(module.layer) || 0;
    rowCounts.set(module.layer, row + 1);
    positions.set(module.id, {
      x: columnCenters[layerIndex],
      y: 76 + row * 104
    });
  });
  const maxRows = Math.max(1, ...rowCounts.values());
  const height = Math.max(560, 150 + (maxRows - 1) * 104);
  mapCanvas.style.height = `${height}px`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'connections');
  svg.setAttribute('viewBox', `0 0 1100 ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', 'generated-arrow');
  marker.setAttribute('markerWidth', '8');
  marker.setAttribute('markerHeight', '8');
  marker.setAttribute('refX', '6');
  marker.setAttribute('refY', '3');
  marker.setAttribute('orient', 'auto');
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrow.setAttribute('d', 'M0,0 L0,6 L6,3 z');
  arrow.setAttribute('fill', 'var(--accent)');
  marker.append(arrow);
  defs.append(marker);
  svg.append(defs);

  edges.slice(0, 100).forEach((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return;
    const direction = to.x >= from.x ? 1 : -1;
    const startX = from.x + direction * 80;
    const endX = to.x - direction * 80;
    const midpoint = (startX + endX) / 2;
    const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathElement.setAttribute('d', `M${startX} ${from.y} C${midpoint} ${from.y}, ${midpoint} ${to.y}, ${endX} ${to.y}`);
    pathElement.setAttribute('marker-end', 'url(#generated-arrow)');
    pathElement.setAttribute('aria-label', `${edge.from} imports from ${edge.to}: ${edge.count} detected imports`);
    pathElement.setAttribute('data-from', edge.from);
    pathElement.setAttribute('data-to', edge.to);
    svg.append(pathElement);
  });
  canvas.append(svg);

  const iconForLayer = {
    frontend: ['◇', 'blue-icon'],
    backend: ['⇄', 'indigo-icon'],
    database: ['▤', 'purple-icon'],
    service: ['●', 'green-icon'],
    shared: ['⌘', 'blue-icon']
  };
  modules.forEach((module) => {
    const position = positions.get(module.id);
    const node = createElement('div', `map-node generated-node ${module.layer}-node`);
    node.dataset.layer = module.layer;
    node.style.left = `${(position.x / 1100) * 100}%`;
    node.style.top = `${position.y}px`;
    const [icon, iconClass] = iconForLayer[module.layer] || ['●', 'green-icon'];
    node.append(createElement('span', `node-icon ${iconClass}`, icon));
    const description = createElement('div');
    description.append(createElement('strong', '', module.name));
    description.append(createElement('small', '', `${module.path} · ${module.fileCount.toLocaleString()} files`));
    node.append(description);
    canvas.append(node);
  });

  const layerCount = groups.size;
  document.getElementById('map-summary').textContent =
    `${modules.length} modules · ${layerCount} inferred layers · ${edges.length} local import links`;
  document.getElementById('map-repository-name').textContent =
    document.getElementById('repository-name').textContent;
}

function renderStructureObservations(analysis) {
  const container = document.getElementById('structure-observations');
  const violations = document.getElementById('violation-cards');
  container.replaceChildren();
  violations.replaceChildren();
  const moduleMap = new Map(analysis.modules.map((module) => [module.id, module]));
  const crossLayerEdges = analysis.edges.filter((edge) =>
    moduleMap.get(edge.from)?.layer !== moduleMap.get(edge.to)?.layer);
  document.getElementById('drift-title').textContent = `${crossLayerEdges.length} cross-layer links`;

  if (!crossLayerEdges.length) {
    container.append(createElement('p', 'empty-state', 'No cross-layer imports were detected in the analyzed files.'));
    violations.append(createElement('p', 'empty-state', 'No cross-layer imports were detected. Static import detection is heuristic and does not enforce architecture rules.'));
    return;
  }

  crossLayerEdges.slice(0, 8).forEach((edge) => {
    const source = moduleMap.get(edge.from);
    const target = moduleMap.get(edge.to);
    const sourceName = source ? source.name : edge.from;
    const targetName = target ? target.name : edge.to;
    const item = createElement('div', 'signal-item');
    item.append(createElement('span', 'signal-icon amber', '↗'));
    const details = createElement('div');
    details.append(createElement('strong', '', `${sourceName} → ${targetName}`));
    details.append(createElement('small', '', `${source?.layer || 'module'} → ${target?.layer || 'module'} · ${edge.count} local imports`));
    item.append(details);
    item.append(createElement('span', 'signal-time', 'static'));
    container.append(item);

    const card = createElement('article', 'violation-card panel');
    const top = createElement('div', 'violation-top');
    top.append(createElement('span', 'warning-badge', 'STATIC OBSERVATION'));
    top.append(createElement('span', 'mono muted', `${edge.count} imports`));
    card.append(top);
    card.append(createElement('h3', '', `${sourceName} → ${targetName}`));
    card.append(createElement('p', '', `Detected local imports between the inferred ${source?.layer || 'module'} and ${target?.layer || 'module'} layers. This is an observation, not a configured architecture-rule violation.`));
    const footer = createElement('div', 'violation-footer');
    footer.append(createElement('span', '', 'Inferred module dependency'));
    footer.append(createElement('span', 'rule-id', `${source?.fileCount || 0} source files`));
    card.append(footer);
    violations.append(card);
  });
}

function renderRepositoryHistory(commits) {
  const activity = document.getElementById('activity-rows');
  activity.replaceChildren();
  const timeline = document.getElementById('repository-timeline');
  timeline.replaceChildren();
  const caption = document.getElementById('repository-timeline-caption');
  caption.replaceChildren();
  document.getElementById('timeline-commit-count').textContent = commits.length.toLocaleString();
  if (!commits.length) {
    const empty = createElement('p', 'empty-state', 'No commit history was returned for this repository.');
    activity.append(empty);
    timeline.append(createElement('p', 'empty-state timeline-empty', 'No commit history is available.'));
    return;
  }

  const trackLine = createElement('div', 'track-line');
  timeline.append(trackLine);
  const orderedCommits = commits.slice(0, 5).reverse();
  orderedCommits.forEach((commit, index) => {
    const activityRow = createElement('div', 'table-row');
    const event = createElement('span', 'event-name');
    event.append(createElement('span', 'event-avatar purple', '⌁'));
    const eventDetails = createElement('span');
    eventDetails.append(createElement('strong', '', commit.message || 'Untitled commit'));
    eventDetails.append(createElement('small', '', `${commit.shortSha} · ${formatRelativeDate(commit.date)}`));
    event.append(eventDetails);
    activityRow.append(event);
    activityRow.append(createElement('span', 'status-pill', 'Git history'));
    activityRow.append(createElement('span', 'mono', commit.shortSha));
    activityRow.append(createElement('span', 'mono muted', formatRelativeDate(commit.date)));
    activity.append(activityRow);

    const position = orderedCommits.length === 1 ? 50 : 8 + (index / (orderedCommits.length - 1)) * 84;
    const entry = createElement('div', 'timeline-commit repository-commit');
    entry.style.left = `${position}%`;
    const card = createElement('div', 'commit-card');
    card.append(createElement('span', 'commit-number', commit.shortSha));
    card.append(createElement('strong', '', commit.message || 'Untitled commit'));
    card.append(createElement('small', '', new Date(commit.date).toLocaleDateString()));
    entry.append(card, createElement('span', 'commit-dot'), createElement('span', 'timeline-state', 'History only'));
    timeline.append(entry);
    caption.append(createElement('span', '', new Date(commit.date).toLocaleDateString()));
  });
}

function updateGithubConnection(login) {
  const connected = Boolean(login);
  githubConnectButton.hidden = connected;
  githubConnected.hidden = !connected;
  githubRepoPicker.hidden = !connected;
  githubLogin.textContent = connected ? `@${login}` : '';
  githubSettingsStatus.textContent = connected ? `Connected as @${login}` : 'Not connected';
  githubDisconnectButton.disabled = !connected;
  if (!connected && selectedRepository?.source === 'github') setRepositorySelection(null);
}

async function githubJson(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  let body;
  try {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if (contentType.includes('text/html')) {
        throw new Error('The Driftwatch API is not deployed at this site. Deploy the Node server and route /api requests to it.');
      }
      throw new Error('The Driftwatch server returned a non-JSON response.');
    }
    body = await response.json();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('The Driftwatch ')) throw error;
    throw new Error('The Driftwatch server returned invalid JSON.');
  }
  if (!response.ok) {
    if (body.code === 'reconnect_required') updateGithubConnection(null);
    throw new Error(body.error || 'The request could not be completed.');
  }
  return body;
}

async function loadGithubRepositories() {
  setGithubMessage('Loading public repositories…', false);
  githubRepoList.replaceChildren();
  try {
    const result = await githubJson('/api/github/repos');
    githubRepositories = result.repositories;
    updateGithubRepoList();
    setGithubMessage(githubRepositories.length
      ? ''
      : 'No public repositories were found for this account. You can paste a public repository URL below.');
  } catch (error) {
    setGithubMessage(error.message);
  }
}

async function refreshGithubConnection() {
  try {
    const status = await githubJson('/api/github/status');
    updateGithubConnection(status.connected ? status.login : null);
    if (status.error) setGithubMessage(status.error);
    if (status.connected) await loadGithubRepositories();
  } catch (error) {
    setGithubMessage(`GitHub connection status is unavailable: ${error.message}`);
  }
}

async function beginGithubConnection() {
  githubConnectButton.disabled = true;
  setGithubMessage('Preparing secure GitHub sign-in…', false);
  try {
    const result = await githubJson('/api/github/connect');
    window.location.assign(result.url);
  } catch (error) {
    setGithubMessage(error.message);
    githubConnectButton.disabled = false;
  }
}

function parsePublicRepositoryUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid public GitHub repository URL.');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com'
      || parts.length !== 2 || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('Use a public repository URL in the form https://github.com/owner/repository.');
  }
  let owner;
  let repository;
  try {
    owner = decodeURIComponent(parts[0]);
    repository = decodeURIComponent(parts[1]).replace(/\.git$/i, '');
  } catch {
    throw new Error('Enter a valid github.com/owner/repository URL.');
  }
  if (!/^[A-Za-z0-9-]{1,100}$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(repository)) {
    throw new Error('Enter a valid github.com/owner/repository URL.');
  }
  return { owner, repo: repository };
}

repoUrlInput.addEventListener('input', () => {
  setRepositorySelection(null);
  dashboardRepoUrlInput.value = repoUrlInput.value;
  setPublicScanMessage('');
});

dashboardRepoUrlInput.addEventListener('input', () => {
  repoUrlInput.value = dashboardRepoUrlInput.value;
  onboardingScanButton.disabled = !repoUrlInput.value.trim();
  setPublicScanMessage('');
});

repoForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await runPublicScan({ url: repoUrlInput.value });
});

dashboardRepoForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await runPublicScan({ url: dashboardRepoUrlInput.value });
});
dashboardDemoButton.addEventListener('click', () => runPublicScan({ demo: true }));
loadHistoryButton.addEventListener('click', () => loadRepositoryHistory());
loadDashboardHistoryButton.addEventListener('click', () => loadRepositoryHistory());

githubConnectButton.addEventListener('click', beginGithubConnection);
githubSwitchButton.addEventListener('click', beginGithubConnection);
githubRepoSearch.addEventListener('input', updateGithubRepoList);
githubDisconnectButton.addEventListener('click', async () => {
  githubDisconnectButton.disabled = true;
  setGithubSettingsMessage('Disconnecting GitHub…', false);
  try {
    const result = await githubJson('/api/github/disconnect', { method: 'POST' });
    updateGithubConnection(null);
    githubRepositories = [];
    githubRepoList.replaceChildren();
    setGithubMessage('');
    setGithubSettingsMessage(result.message || (result.revoked
      ? 'GitHub disconnected and access revoked.'
      : 'GitHub disconnected from Driftwatch.'), !result.revoked && Boolean(result.message));
  } catch (error) {
    setGithubSettingsMessage(error.message);
    githubDisconnectButton.disabled = false;
  }
});
sampleButton.addEventListener('click', () => runPublicScan({ demo: true }));

closeScan.addEventListener('click', () => {
  cancelActiveScan();
  scanOverlay.classList.remove('visible');
});
retryScanButton.addEventListener('click', () => {
  if (!retryScanOptions) return;
  const options = retryScanOptions;
  retryScanOptions = null;
  runPublicScan(options);
});
scanOverlay.addEventListener('click', (event) => {
  if (event.target === scanOverlay) closeScan.click();
});

onboarding.classList.add('visible');
appShell.classList.remove('ready');

document.querySelectorAll('.filter-active').forEach((button) => {
  button.addEventListener('click', () => {
    button.parentElement.querySelectorAll('button').forEach((item) => item.classList.remove('filter-active'));
    button.classList.add('filter-active');
    button.parentElement.querySelectorAll('button').forEach((item) => {
      item.setAttribute('aria-pressed', String(item === button));
    });
  });
});

document.getElementById('notifications-button').addEventListener('click', () => {
  document.getElementById('notifications-button').setAttribute('aria-pressed', 'true');
  document.querySelector('.notification-dot').hidden = true;
  showToast('You are all caught up. No new architecture alerts.');
});

document.getElementById('activity-button').addEventListener('click', () => {
  document.querySelector('.activity-table').scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast('Showing the latest guardian activity.');
});

document.querySelectorAll('.more-button').forEach((button) => {
  button.addEventListener('click', () => {
    const willOpen = button.getAttribute('aria-expanded') !== 'true';
    closePanelMenus();
    button.setAttribute('aria-expanded', String(willOpen));
    const menu = document.getElementById(button.getAttribute('aria-controls'));
    menu.hidden = !willOpen;
    if (willOpen) menu.querySelector('[role="menuitem"]').focus();
  });
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.panel-menu-wrap')) closePanelMenus();
});

document.addEventListener('keydown', (event) => {
  const openMenu = event.target instanceof Element ? event.target.closest('.panel-menu') : null;
  if (event.key === 'Escape') {
    closePanelMenus(true);
  } else if (openMenu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    const items = [...openMenu.querySelectorAll('[role="menuitem"]')];
    const index = items.indexOf(document.activeElement);
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    event.preventDefault();
    items[nextIndex].focus();
  }
});

function updateMapZoom() {
  mapCanvas.style.setProperty('--map-zoom', `${mapZoom / 100}`);
  mapZoomLevel.textContent = `${mapZoom}%`;
  document.getElementById('map-zoom-in').disabled = mapZoom >= 130;
  document.getElementById('map-zoom-out').disabled = mapZoom <= 70;
}

document.getElementById('map-zoom-in').addEventListener('click', () => {
  mapZoom = Math.min(130, mapZoom + 10);
  updateMapZoom();
});

document.getElementById('map-zoom-out').addEventListener('click', () => {
  mapZoom = Math.max(70, mapZoom - 10);
  updateMapZoom();
});
updateMapZoom();

document.querySelectorAll('[data-action="export-report"]').forEach((button) => button.addEventListener('click', () => {
  if (!currentScan) {
    showToast('Scan a repository before exporting its report.');
    return;
  }
  const reportUrl = URL.createObjectURL(new Blob([JSON.stringify(currentScan, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = reportUrl;
  link.download = `driftwatch-${currentScan.repo.replace('/', '-')}-report.json`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(reportUrl), 1000);
  closePanelMenus(true);
  showToast('Report exported successfully.');
}));

exportCsvButton.addEventListener('click', () => {
  if (!currentScan || !Array.isArray(currentScan.violations)) {
    showToast('Scan a repository before exporting violations.');
    return;
  }
  const headers = [
    'repo', 'branch', 'health score', 'scan date',
    'rule id', 'severity', 'from file', 'to file', 'from layer', 'to layer', 'message'
  ];
  const metadata = [currentScan.repo, currentScan.branch, currentScan.healthScore, currentScanDate];
  const violations = currentScan.violations.length
    ? currentScan.violations.map((violation) => [
      violation.ruleId,
      violation.severity,
      violation.fromFile,
      violation.toFile,
      violation.fromLayer,
      violation.toLayer,
      violation.message
    ])
    : [[ '', '', '', '', '', '', '' ]];
  const csv = window.DriftwatchCsv.rowsToCsv([
    headers,
    ...violations.map((violation) => [...metadata, ...violation])
  ]);
  const blobUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  const safeRepo = currentScan.repo.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/g, '') || 'repository';
  const date = (currentScanDate || new Date().toISOString()).slice(0, 10);
  link.href = blobUrl;
  link.download = `driftwatch-${safeRepo}-${date}.csv`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
});

document.querySelectorAll('.toggle-input').forEach((input) => {
  input.addEventListener('change', () => showToast(`${input.closest('.setting-row').querySelector('strong').textContent} ${input.checked ? 'enabled' : 'disabled'}.`));
});

document.getElementById('reset-onboarding').addEventListener('click', () => {
  window.localStorage.removeItem('driftwatch-onboarded');
  onboarding.classList.add('visible');
  appShell.classList.remove('ready');
  repoUrlInput.value = '';
  dashboardRepoUrlInput.value = '';
  setRepositorySelection(null);
  currentScan = null;
  currentScanDate = '';
  currentScanUrl = '';
  currentIsDemo = false;
  currentHistory = null;
  updateDriftChatWelcome();
  exportCsvButton.hidden = true;
  showToast('First-time setup is ready.');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
