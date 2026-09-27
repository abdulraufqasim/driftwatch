const navItems = document.querySelectorAll('[data-view]');
const sections = document.querySelectorAll('.page-section');
const scanOverlay = document.getElementById('scan-overlay');
const scanButton = document.getElementById('scan-button');
const closeScan = document.getElementById('close-scan');
const progressBar = document.getElementById('progress-bar');
const progressLabel = document.getElementById('progress-label');
const progressPercent = document.getElementById('progress-percent');
const scanSteps = [...document.querySelectorAll('.scan-step')];
const searchInput = document.getElementById('repo-search');
const activityRows = [...document.querySelectorAll('.activity-table .table-row')];
const onboarding = document.getElementById('onboarding');
const appShell = document.getElementById('app-shell');
const repoForm = document.getElementById('repo-form');
const repoUrlInput = document.getElementById('repo-url');
const sampleButton = document.getElementById('sample-button');
const onboardingScanButton = document.getElementById('onboarding-scan');
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
const mapCanvas = document.querySelector('.architecture-canvas');
const mapZoomLevel = document.getElementById('map-zoom-level');
const themeToggles = [...document.querySelectorAll('[data-theme-toggle]')];
const brandLogos = [...document.querySelectorAll('.brand-logo, .onboarding-brand img')];
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarBackdrop = document.querySelector('.sidebar-backdrop');
const mobileSidebarQuery = window.matchMedia('(max-width: 700px)');
const panelMenuToggles = [...document.querySelectorAll('.more-button')];
let scanTimer;
let mapZoom = 100;
let isSidebarOpen = !mobileSidebarQuery.matches;
let githubRepositories = [];
let selectedRepository = null;

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
  activityRows.forEach((row) => {
    row.hidden = query && !row.textContent.toLowerCase().includes(query);
  });
});

function resetScan() {
  window.clearInterval(scanTimer);
  progressBar.style.width = '0%';
  progressLabel.textContent = 'Initializing scan';
  progressPercent.textContent = '0%';
  scanSteps.forEach((step, index) => {
    step.classList.toggle('active', index === 0);
    step.classList.remove('done');
    step.querySelector('i').textContent = '○';
  });
}

function startScan() {
  resetScan();
  scanOverlay.classList.add('visible');
  let progress = 0;
  let currentStep = 0;
  scanTimer = window.setInterval(() => {
    progress += 4;
    const stepIndex = Math.min(Math.floor(progress / 20), scanSteps.length - 1);
    progressBar.style.width = `${progress}%`;
    progressPercent.textContent = `${progress}%`;
    if (stepIndex !== currentStep) {
      scanSteps[currentStep].classList.remove('active');
      scanSteps[currentStep].classList.add('done');
      scanSteps[currentStep].querySelector('i').textContent = '✓';
      currentStep = stepIndex;
      scanSteps[currentStep].classList.add('active');
    }
    progressLabel.textContent = scanSteps[currentStep].dataset.step;
    if (progress >= 100) {
      window.clearInterval(scanTimer);
      scanSteps[currentStep].classList.remove('active');
      scanSteps[currentStep].classList.add('done');
      scanSteps[currentStep].querySelector('i').textContent = '✓';
      progressLabel.textContent = 'Scan complete';
      window.setTimeout(() => {
        scanOverlay.classList.remove('visible');
        onboarding.classList.remove('visible');
        appShell.classList.add('ready');
        window.localStorage.setItem('driftwatch-onboarded', 'true');
      }, 700);
    }
  }, 110);
}

scanButton.addEventListener('click', startScan);
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
  onboardingScanButton.disabled = !selectedRepository;
  githubSelection.replaceChildren();
  githubSelection.hidden = !selectedRepository;
  if (!selectedRepository) return;

  const name = document.createElement('strong');
  name.textContent = selectedRepository.full_name;
  const details = document.createElement('span');
  const updatedAt = new Date(selectedRepository.updated_at);
  const updatedText = Number.isNaN(updatedAt.getTime())
    ? ''
    : ` · Updated ${updatedAt.toLocaleDateString()}`;
  details.textContent = `Public${updatedText}`;
  githubSelection.append(name, details);
  setGithubMessage(`${selectedRepository.full_name} selected. Repository scanning will be available in a later phase.`, false);
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
    body = await response.json();
  } catch {
    throw new Error('The Driftwatch server returned an invalid response.');
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
      || parts.length !== 2 || url.username || url.password || url.search || url.hash) {
    throw new Error('Use a public repository URL in the form https://github.com/owner/repository.');
  }
  const repository = parts[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9-]{1,100}$/.test(parts[0]) || !/^[A-Za-z0-9._-]{1,100}$/.test(repository)) {
    throw new Error('Enter a valid github.com/owner/repository URL.');
  }
  return { owner: parts[0], repo: repository };
}

repoUrlInput.addEventListener('input', () => {
  if (repoUrlInput.value.trim()) {
    setRepositorySelection(null);
    setGithubMessage('');
  }
});

repoForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (selectedRepository) {
    setGithubMessage(`${selectedRepository.full_name} selected. Repository scanning will be available in a later phase.`, false);
    return;
  }

  try {
    const { owner, repo } = parsePublicRepositoryUrl(repoUrlInput.value.trim());
    onboardingScanButton.disabled = true;
    setGithubMessage('Checking public repository…', false);
    const result = await githubJson(`/api/github/public-repository?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`);
    setRepositorySelection(result.repository, 'manual');
  } catch (error) {
    setGithubMessage(error.message);
  } finally {
    onboardingScanButton.disabled = !selectedRepository;
  }
});

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
refreshGithubConnection();

sampleButton.addEventListener('click', () => {
  repoUrlInput.value = 'https://github.com/quantum-forge/my-app';
  startScan();
});
closeScan.addEventListener('click', () => {
  scanOverlay.classList.remove('visible');
  window.clearInterval(scanTimer);
});
scanOverlay.addEventListener('click', (event) => {
  if (event.target === scanOverlay) closeScan.click();
});

onboarding.classList.add('visible');
appShell.classList.remove('ready');

document.querySelectorAll('.filter-active, .timeline-filter button').forEach((button) => {
  button.addEventListener('click', () => {
    button.parentElement.querySelectorAll('button').forEach((item) => item.classList.remove('filter-active'));
    button.classList.add('filter-active');
    button.parentElement.querySelectorAll('button').forEach((item) => {
      item.setAttribute('aria-pressed', String(item === button));
    });
    if (button.closest('.timeline-filter')) {
      const showDrift = button.textContent.trim() === 'Drift only';
      document.querySelectorAll('.timeline-commit').forEach((commit) => {
        commit.hidden = showDrift && commit.classList.contains('healthy-commit');
      });
      showToast(showDrift ? 'Showing commits with architecture drift.' : 'Showing all commits.');
    }
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
  const report = 'Driftwatch architecture report\n\nRepository: my-app\nHealth score: 87 / 100\nHealthy paths: 24\nWarnings: 2\nCritical issues: 0\n';
  const reportUrl = URL.createObjectURL(new Blob([report], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = reportUrl;
  link.download = 'driftwatch-my-app-report.txt';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(reportUrl), 1000);
  closePanelMenus(true);
  showToast('Report exported successfully.');
}));

document.querySelectorAll('.toggle-input').forEach((input) => {
  input.addEventListener('change', () => showToast(`${input.closest('.setting-row').querySelector('strong').textContent} ${input.checked ? 'enabled' : 'disabled'}.`));
});

document.getElementById('reset-onboarding').addEventListener('click', () => {
  window.localStorage.removeItem('driftwatch-onboarded');
  onboarding.classList.add('visible');
  appShell.classList.remove('ready');
  repoUrlInput.value = '';
  showToast('First-time setup is ready.');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
