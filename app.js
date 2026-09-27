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
const mapCanvas = document.querySelector('.architecture-canvas');
const mapZoomLevel = document.getElementById('map-zoom-level');
const themeToggles = [...document.querySelectorAll('[data-theme-toggle]')];
const brandLogo = document.querySelector('.brand-logo');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarBackdrop = document.querySelector('.sidebar-backdrop');
const mobileSidebarQuery = window.matchMedia('(max-width: 700px)');
const panelMenuToggles = [...document.querySelectorAll('.more-button')];
let scanTimer;
let mapZoom = 100;
let isSidebarOpen = !mobileSidebarQuery.matches;

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
  if (brandLogo) {
    brandLogo.src = isLight ? 'drift-logo.png' : 'drift-logo-dark.png';
    brandLogo.srcset = isLight
      ? 'drift-logo.png 1x, drift-logo.png 2x'
      : 'drift-logo-dark.png 1x, drift-logo-dark@2x.png 2x';
  }
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
function beginFirstScan(event) {
  if (event) event.preventDefault();
  const repositoryUrl = repoUrlInput.value.trim();
  if (repositoryUrl && !/^https?:\/\/.+/i.test(repositoryUrl)) {
    repoUrlInput.setCustomValidity('Enter a valid Git repository URL.');
    repoUrlInput.reportValidity();
    return;
  }
  repoUrlInput.setCustomValidity('');
  startScan();
}

repoForm.addEventListener('submit', beginFirstScan);
sampleButton.addEventListener('click', () => {
  repoUrlInput.value = 'https://github.com/quantum-forge/my-app';
  beginFirstScan();
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
