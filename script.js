(() => {
  'use strict';
  // Canvas elements and the stroke settings for each feeling.
  const $ = id => document.getElementById(id);
  const canvas = $('atlas'),
    stage = $('stage'),
    ctx = canvas.getContext('2d', {
      alpha: false
    });
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'
  ];
  const shortNames = names.map(n => n.slice(0, 3).toUpperCase());
  const TAU = Math.PI * 2,
    KEY = 'ring-atlas-entries-v3',
    INTRO_KEY = 'ring-atlas-intro-seen-v1',
    LEGACY_KEYS = ['ring-atlas-2026-entries-v2', 'ring-atlas-2026-entries-v1'];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const profiles = {
    Calm: {
      weight: 1.2,
      rough: .72,
      direction: .15,
      pace: 1.15
    },
    Hopeful: {
      weight: 1,
      rough: 1.05,
      direction: -.75,
      pace: .92
    },
    Restless: {
      weight: .78,
      rough: 1.55,
      direction: 1.25,
      pace: .68
    },
    Tender: {
      weight: .84,
      rough: .87,
      direction: -2.2,
      pace: 1.18
    },
    Heavy: {
      weight: 1.48,
      rough: .82,
      direction: 1.65,
      pace: 1.32
    },
    Energized: {
      weight: 1.02,
      rough: 1.32,
      direction: -.28,
      pace: .7
    },
    other: {
      weight: 1,
      rough: 1,
      direction: .3,
      pace: 1
    }
  };
  // Active year, month, saved entries, and animation state.
  const nowDate = new Date();
  let year = clamp(nowDate.getFullYear(), 2026, 2027);
  let month = nowDate.getFullYear() === year ? nowDate.getMonth() : 0;
  let mode = 'month',
    entries = loadEntries(),
    selectedDate = dateForMonth(month),
    w = 0,
    h = 0,
    dpr = 1,
    centers = [];
  let baseStart = performance.now(),
    lastFrame = 0;
  let animations = new Map(),
    hitPaths = [],
    dayPaths = [],
    hoveredDay = null,
    dirty = true;
  let transitioning = false,
    focusMonth = null,
    focusStart = 0,
    growthPaused = false,
    firstIntro = false;

  // Stable seeds keep each day's shape consistent after a page reload.
  function hash(value) {
    let x = 2166136261;
    for (const c of String(value)) {
      x ^= c.charCodeAt(0);
      x = Math.imul(x, 16777619)
    }
    return x >>> 0;
  }

  function random(seed) {
    let x = Math.sin(seed * 127.1 + 41.7) * 43758.5453;
    return x - Math.floor(x)
  }

  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x))
  }

  function ease(x) {
    x = clamp(x, 0, 1);
    return x * x * (3 - 2 * x)
  }

  function loadEntries() {
    try {
      const saved = localStorage.getItem(KEY),
        legacy = LEGACY_KEYS.map(key => localStorage.getItem(key)).find(value => value !== null),
        data = JSON.parse(saved ?? legacy ?? '[]');
      if (!Array.isArray(data)) return [];
      const valid = data.filter(e => e && typeof e.id === 'string' &&
          /^202[67]-(0[1-9]|1[0-2])-[0-3][0-9]$/.test(e.date) && typeof e.feeling === 'string')
        .filter(e => Number(e.date.slice(8, 10)) >= 1 && Number(e.date.slice(8, 10)) <=
          daysInMonth(Number(e.date.slice(0, 4)), Number(e.date.slice(5, 7)) - 1))
        .map(e => ({
          id: e.id,
          date: e.date,
          feeling: e.feeling.slice(0, 28),
          thought: String(e.thought || '').slice(0, 180),
          createdAt: Number(e.createdAt) || 0,
          updatedAt: Number(e.updatedAt) || 0
        }));
      const byDate = new Map();
      for (const entry of valid) {
        const prior = byDate.get(entry.date);
        if (!prior || (entry.updatedAt || entry.createdAt) >= (prior.updatedAt || prior
          .createdAt)) byDate.set(entry.date, entry)
      }
      const unique = [...byDate.values()];
      if (saved === null || unique.length !== valid.length) try {
        localStorage.setItem(KEY, JSON.stringify(unique))
      } catch {}
      return unique;
    } catch {
      return [];
    }
  }

  function saveEntries() {
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
      return true
    } catch {
      return false
    }
  }

  function hasSeenIntro() {
    try {
      return localStorage.getItem(INTRO_KEY) === '1'
    } catch {
      return false
    }
  }

  function monthOf(e) {
    return Number(e.date.slice(5, 7)) - 1
  }

  function monthEntries(i, y = year) {
    return entries.filter(e => monthOf(e) === i && Number(e.date.slice(0, 4)) === y).sort((a,
      b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b
        .id))
  }

  function profile(e) {
    if (profiles[e.feeling]) return profiles[e.feeling];
    const seed = hash(e.feeling);
    return {
      weight: .78 + random(seed) * .6,
      rough: .78 + random(seed + 3) * .75,
      direction: random(seed + 7) * TAU,
      pace: .78 + random(seed + 11) * .5
    };
  }

  function daysInMonth(y, i) {
    return new Date(y, i + 1, 0).getDate()
  }

  function dayGap(i, R, y = year) {
    return R * .78 / (daysInMonth(y, i) - 1)
  }

  function dayRadius(day, i, R, y = year) {
    return R * (.17 + .78 * (day - 1) / (daysInMonth(y, i) - 1))
  }

  function memoryRadius(entry, c) {
    return dayRadius(Number(entry.date.slice(8, 10)), c.i, c.r, c.year)
  }

  function formatted(date) {
    return new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    })
  }

  function dateForMonth(i, y = year) {
    const d = nowDate.getFullYear() === y && nowDate.getMonth() === i ? nowDate.getDate() : 1;
    return `${y}-${String(i+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }

  // Size the canvas for the current view and screen width.
  function layout() {
    const rect = stage.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (mode === 'month') {
      centers = [{
        x: w * .5,
        y: h * .49,
        r: Math.min(w * .43, h * .42, 380),
        i: month,
        year,
        seed: month + (year - 2026) * 12
      }];
    } else {
      const mobile = w < 700,
        cols = mobile ? 3 : 4,
        rows = mobile ? 4 : 3;
      const margin = mobile ? 12 : 46,
        top = mobile ? 54 : 42,
        bottom = mobile ? 42 : 35;
      const cw = (w - margin * 2) / cols,
        ch = (h - top - bottom) / rows;
      centers = names.map((_, i) => ({
        x: margin + (i % cols + .5) * cw + (random(i + 22 + (year - 2026) * 12) - .5) * cw *
          .13,
        y: top + (Math.floor(i / cols) + .5) * ch + (random(i + 62 + (year - 2026) * 12) -
          .5) * ch * .1,
        r: Math.min(cw * .43, ch * .4, 79) * (0.9 + random(i + 28 + (year - 2026) * 12) *
          .14),
        i,
        year,
        seed: i + (year - 2026) * 12
      }));
    }
    dirty = true;
    const buttons = $('month-buttons');
    buttons.replaceChildren();
    if (mode === 'year') centers.forEach(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'month-button';
      b.textContent = shortNames[c.i];
      b.setAttribute('aria-label', `View ${names[c.i]} ${year}`);
      b.style.left = c.x + 'px';
      b.style.top = (c.y + c.r * 1.01 + 12) + 'px';
      b.addEventListener('click', () => openMonth(c.i));
      buttons.appendChild(b);
    });
  }

  function setView(next, i = month) {
    const changedMonth = i !== month,
      changedView = next !== mode;
    mode = next;
    month = i;
    stage.classList.toggle('year', mode === 'year');
    $('main').classList.toggle('year-mode', mode === 'year');
    if (changedMonth || changedView) {
      baseStart = performance.now();
      animations.clear()
    }
    if (changedMonth) selectedDate = dateForMonth(month);
    $('month-view').classList.toggle('active', mode === 'month');
    $('year-view').classList.toggle('active', mode === 'year');
    $('month-view').setAttribute('aria-pressed', String(mode === 'month'));
    $('year-view').setAttribute('aria-pressed', String(mode === 'year'));
    $('view-title').innerHTML = mode === 'year' ? String(year) :
      `${names[month]} <em>${year}</em>`;
    const yearView = mode === 'year',
      previous = $('previous-period'),
      nextButton = $('next-period');
    previous.disabled = yearView ? year === 2026 : year === 2026 && month === 0;
    nextButton.disabled = yearView ? year === 2027 : year === 2027 && month === 11;
    previous.setAttribute('aria-label', yearView ? 'Previous year' : 'Previous month');
    nextButton.setAttribute('aria-label', yearView ? 'Next year' : 'Next month');
    $('period-navigation').setAttribute('aria-label', yearView ? 'Browse years' :
    'Browse months');
    const periodName = step => yearView ? String(year + step) :
      `${names[new Date(year,month+step,1).getMonth()]} ${new Date(year,month+step,1).getFullYear()}`;
    previous.title = previous.disabled ? '' : periodName(-1);
    nextButton.title = nextButton.disabled ? '' : periodName(1);
    $('view-note').textContent = mode === 'year' ? 'Select a month to enter its archive.' :
      'One ring for each day. Blue days hold a mark.';
    canvas.setAttribute('aria-label', mode === 'year' ?
      'Twelve monthly ring formations; select a month to open its archive' :
      'Daily tree rings; hover a ring to highlight it and click to select its date');
    $('interaction-hint').textContent = mode === 'year' ? 'Select a month to open its archive' :
      'Hover a day ring to darken it · Click to select its date';
    if (mode === 'month') {
      renderCalendar();
      renderDiary();
      renderEntries();
    }
    hoveredDay = null;
    dirty = true;
    layout();
  }

  function changeYear(next) {
    if (transitioning || next < 2026 || next > 2027 || next === year) return;
    year = next;
    selectedDate = dateForMonth(month);
    baseStart = performance.now();
    animations.clear();
    setView(mode);
    $('form-status').textContent = '';
  }

  function stepPeriod(direction) {
    if (transitioning) return;
    if (mode === 'year') {
      changeYear(year + direction);
      return
    }
    const index = (year - 2026) * 12 + month + direction;
    if (index < 0 || index >= 24) return;
    year = 2026 + Math.floor(index / 12);
    setView('month', index % 12);
    $('form-status').textContent = '';
  }

  function openMonth(i) {
    if (mode !== 'year' || transitioning) return;
    const c = centers.find(center => center.i === i);
    if (!c || reduceMotion) {
      setView('month', i);
      return
    }
    transitioning = true;
    focusMonth = i;
    focusStart = performance.now();
    dirty = true;
    stage.classList.add('focusing');
    setTimeout(() => {
      stage.classList.remove('focusing');
      transitioning = false;
      focusMonth = null;
      setView('month', i);
      if (innerWidth < 850) stage.scrollIntoView({
        block: 'center',
        behavior: 'instant'
      });
      else window.scrollTo(0, 0);
    }, 330);
  }

  function openIntro(firstVisit = false) {
    const dialog = $('intro-dialog');
    if (dialog.open) return;
    firstIntro = firstVisit;
    if (firstVisit) {
      growthPaused = true;
      dirty = true
    }
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else if (firstVisit) {
      firstIntro = false;
      growthPaused = false;
      baseStart = performance.now();
      dirty = true
    }
  }

  // Calculate irregular ring points, including the influence of a saved feeling.
  function point(c, r, a, ringIndex, memories, entryIndex) {
    const i = c.i,
      phase = random(c.seed + 1) * TAU,
      seed = entryIndex < 0 ? ringIndex * 17 + c.seed * 31 : hash(memories[entryIndex].id);
    const entry = entryIndex < 0 ? null : memories[entryIndex],
      p = entry ? profile(entry) : null;
    const rough = p ? p.rough : 1,
      gap = dayGap(i, c.r, c.year);
    const base = Math.sin(a * 3 + phase + ringIndex * .03) * .065 + Math.sin(a * 5 - phase * .8 +
      ringIndex * .019) * .034 + Math.sin(a * 9 + phase * 1.7) * .012;
    const local = gap * rough * (Math.sin(a * 7 + seed * .003) * .3 + Math.sin(a * 13 + seed *
      .007) * .13 + Math.sin(a * 23 + seed * .011) * .05);
    const directional = Math.sin(a - phase) * .078 + Math.cos(a * 2 + phase * .7) * .044;
    let rr = r * (1 + base + directional) + local;
    if (entry) {
      rr += gap * .22 * rough * Math.sin(a * 4 + seed * .0007);
    }
    let x = c.x + Math.cos(a) * rr * 1.04,
      y = c.y + Math.sin(a) * rr * .93;
    if (entry) {
      const drift = p.direction + random(seed) * .8;
      x += Math.cos(drift) * c.r * .024 * (r / c.r);
      y += Math.sin(drift) * c.r * .024 * (r / c.r);
    }
    if (mode === 'year')
      for (const other of centers) {
        if (other.i === i || Math.hypot(c.x - other.x, c.y - other.y) > c.r + other.r + 28)
          continue;
        const dx = x - other.x,
          dy = y - other.y,
          dist = Math.hypot(dx, dy) || 1;
        const field = Math.exp(-Math.pow((dist - other.r * .9) / (other.r * .45 + 12), 2));
        x += dx / dist * field * 2.7;
        y += dy / dist * field * 2.7;
      }
    return [x, y];
  }

  function animationProgress(e, now) {
    if (reduceMotion) return 1;
    const start = animations.get(e.id);
    return start === undefined ? 1 : ease((now - start) / (950 * profile(e).pace));
  }

  function dayProgress(i, day, now) {
    if (growthPaused) return 0;
    if (reduceMotion) return 1;
    const index = day - 1;
    return ease((now - baseStart - i * 15 - index * 30) / (620 + index * 14));
  }

  function path(c, r, index, memories, entryIndex, progress) {
    const steps = Math.max(5, Math.ceil((mode === 'month' ? 160 : 90) * progress));
    const points = [],
      start = entryIndex < 0 ? random(c.seed * 13 + index * 7 + 31) * TAU : random(hash(memories[
        entryIndex].id)) * TAU;
    for (let k = 0; k <= steps; k++) points.push(point(c, r, start + TAU * progress * k / steps,
      index, memories, entryIndex));
    return points;
  }

  function stroke(points, color, width) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (let k = 1; k < points.length; k++) ctx.lineTo(...points[k]);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function inkStroke(points, blue, width, seed, highlight = false) {
    if (points.length < 2) return;
    stroke(points, blue ? highlight ? 'rgba(29,62,103,.22)' : 'rgba(29,62,103,.15)' : highlight ?
      'rgba(64,75,76,.26)' : mode === 'year' ? 'rgba(119,128,129,.06)' :
      'rgba(119,128,129,.14)', width * 1.6);
    const sections = mode === 'month' ? 25 : 9;
    const span = Math.max(2, Math.ceil((points.length - 1) / sections));
    const phase = random(seed) * TAU;
    for (let from = 0; from < points.length - 1; from += span) {
      const to = Math.min(points.length - 1, from + span),
        t = (from + to) / (2 * (points.length - 1));
      const widthNoise = .74 + .46 * Math.sin(TAU * 1.7 * t + phase) + .23 * Math.sin(TAU * 5.5 *
        t + phase * 1.7);
      const inkNoise = .57 + .35 * Math.sin(TAU * 3 * t + phase * .8) + .17 * Math.sin(TAU * 11 *
        t + phase * 2.1);
      const alpha = clamp((blue ? highlight ? 1.02 : .88 : highlight ? 1.08 : mode === 'year' ?
          .5 : .72) * inkNoise, blue ? .15 : highlight ? .33 : .07, blue ? .96 : highlight ?
        .96 : mode === 'year' ? .55 : .76);
      ctx.beginPath();
      ctx.moveTo(...points[from]);
      for (let k = from + 1; k <= to; k++) ctx.lineTo(...points[k]);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      ctx.lineWidth = width * clamp(widthNoise, .2, 1.55);
      ctx.strokeStyle = blue ? `rgba(29,62,103,${alpha})` : highlight ?
        `rgba(64,75,76,${alpha})` : `rgba(119,128,129,${alpha})`;
      ctx.stroke();
    }
  }

  function draw(now) {
    ctx.fillStyle = '#f3f0e9';
    ctx.fillRect(0, 0, w, h);
    hitPaths = [];
    dayPaths = [];
    for (const c of centers) {
      ctx.save();
      const focused = mode === 'year' && focusMonth === c.i;
      if (mode === 'year' && focusMonth !== null) {
        const age = now - focusStart,
          fadeOut = 1 - ease((age - 190) / 120);
        ctx.globalAlpha = fadeOut * (focused ? 1 : 1 - ease(age / 220) * .94);
      }
      const memories = monthEntries(c.i, c.year),
        markedDays = new Set(memories.map(e => Number(e.date.slice(8, 10)))),
        count = daysInMonth(c.year, c.i),
        gap = dayGap(c.i, c.r, c.year);
      for (let j = 0; j < count; j++) {
        if (markedDays.has(j + 1)) continue;
        const progress = dayProgress(c.i, j + 1, now);
        if (progress === 0) continue;
        const spacing = (random(c.seed * 9 + j * 11 + 92) - .5) * gap * .28;
        const r = dayRadius(j + 1, c.i, c.r, c.year) + spacing;
        const points = path(c, r, j, memories, -1, progress);
        const highlighted = focused || (mode === 'month' && (hoveredDay ?? Number(selectedDate
          .slice(8, 10))) === j + 1);
        const width = (mode === 'month' ? 1.18 : .55) * (0.87 + random(c.seed * 19 + j * 7) *
        .22);
        inkStroke(points, false, width * (highlighted ? (mode === 'year' ? 1.15 : 1.65) : 1), c
          .seed * 103 + j * 17, highlighted);
        if (mode === 'month' && progress === 1) dayPaths.push({
          day: j + 1,
          points
        });
      }
      memories.forEach((entry, index) => {
        const day = Number(entry.date.slice(8, 10));
        const p = Math.min(dayProgress(c.i, day, now), animationProgress(entry, now));
        if (p <= 0) return;
        const points = path(c, memoryRadius(entry, c), day - 1, memories, index, p);
        const weight = (mode === 'month' ? 2.15 : 1.35) * profile(entry).weight;
        const highlighted = focused || (mode === 'month' && (hoveredDay ?? Number(selectedDate
          .slice(8, 10))) === day);
        inkStroke(points, true, weight * (highlighted ? 1.15 : 1), hash(entry.id),
          highlighted);
        if (mode === 'month' && p === 1) hitPaths.push({
          entry,
          points
        });
      });
      ctx.beginPath();
      ctx.arc(c.x, c.y, mode === 'month' ? 1.35 : 1, 0, TAU);
      ctx.fillStyle = 'rgba(107,103,88,.43)';
      ctx.fill();
      ctx.restore();
    }
  }

  function tick(now) {
    requestAnimationFrame(tick);
    if (now - lastFrame < (mode === 'month' ? 30 : 52)) return;
    lastFrame = now;
    const active = (!growthPaused && now - baseStart < 2500) || animations.size > 0 ||
      transitioning;
    if (dirty || active) {
      draw(now);
      dirty = false
    }
    for (const [id, start] of animations)
      if (now - start > 2200) animations.delete(id);
  }
  // Find the nearest day when someone points to a ring.
  function distanceToSegment(px, py, a, b) {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      len = dx * dx + dy * dy || 1;
    const t = clamp(((px - a[0]) * dx + (py - a[1]) * dy) / len, 0, 1);
    return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
  }

  function nearestTarget(x, y, limit = 8) {
    let best = null,
      distance = limit;
    for (const item of dayPaths)
      for (let k = 1; k < item.points.length; k++) {
        const d = distanceToSegment(x, y, item.points[k - 1], item.points[k]);
        if (d < distance) {
          distance = d;
          best = {
            day: item.day
          }
        }
      }
    for (const item of hitPaths)
      for (let k = 1; k < item.points.length; k++) {
        const d = distanceToSegment(x, y, item.points[k - 1], item.points[k]);
        if (d < distance) {
          distance = d;
          best = {
            day: Number(item.entry.date.slice(8, 10))
          }
        }
      }
    return best;
  }

  function renderCalendar() {
    $('calendar-panel').setAttribute('aria-label', `${names[month]} ${year} calendar`);
    const grid = $('calendar-days');
    grid.replaceChildren();
    const offset = new Date(year, month, 1).getDay();
    for (let k = 0; k < offset; k++) {
      const blank = document.createElement('span');
      blank.setAttribute('aria-hidden', 'true');
      grid.appendChild(blank)
    }
    for (let day = 1; day <= daysInMonth(year, month); day++) {
      const date = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const marked = entries.some(e => e.date === date),
        selected = selectedDate === date;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'calendar-day';
      button.classList.toggle('marked', marked);
      button.classList.toggle('selected', selected);
      button.textContent = String(day);
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', `${formatted(date)}${marked?', marked':''}`);
      button.addEventListener('click', () => selectDate(date));
      button.addEventListener('pointerenter', () => {
        hoveredDay = day;
        dirty = true
      });
      button.addEventListener('pointerleave', () => {
        hoveredDay = null;
        dirty = true
      });
      grid.appendChild(button);
    }
  }

  function renderDiary() {
    const date = selectedDate,
      entry = entries.find(e => e.date === date),
      list = $('card-entries');
    const selectedDay = new Date(date + 'T12:00:00');
    $('selected-date-heading').textContent =
      `${selectedDay.toLocaleDateString('en-US',{weekday:'long'})}, ${Number(date.slice(8,10))}`;
    $('selected-date-heading').setAttribute('aria-label', selectedDay.toLocaleDateString(
    'en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    }));
    $('entry-date').value = date;
    list.replaceChildren();
    if (entry) {
      const article = document.createElement('article');
      article.className = 'diary-entry';
      const feeling = document.createElement('h3'),
        thought = document.createElement('p');
      feeling.textContent = entry.feeling;
      thought.textContent = entry.thought || 'No thought added.';
      article.append(feeling, thought);
      list.appendChild(article);
    } else {
      const empty = document.createElement('p');
      empty.className = 'diary-empty';
      empty.textContent = 'No mark for this day yet.';
      list.appendChild(empty);
    }
    const known = entry && [...$('entry-feeling').options].some(option => option.value === entry
      .feeling && option.value !== 'Something else');
    $('entry-feeling').value = entry ? (known ? entry.feeling : 'Something else') : '';
    $('other-field').hidden = !entry || known;
    $('entry-other').required = !!entry && !known;
    $('entry-other').value = entry && !known ? entry.feeling : '';
    $('entry-form').classList.toggle('has-other', !!entry && !known);
    $('entry-thought').value = entry?.thought || '';
    $('save-button').textContent = entry ? 'Update mark' : 'Settle mark';
  }

  function selectDate(date) {
    selectedDate = date;
    hoveredDay = null;
    renderCalendar();
    renderDiary();
    $('form-status').textContent = '';
    dirty = true;
  }

  function renderEntries() {
    const list = $('entries-list'),
      items = monthEntries(month, year);
    $('entry-count').textContent = String(items.length);
    list.replaceChildren();
    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'empty-list';
      p.textContent = 'No memories here yet.';
      list.appendChild(p)
    } else
      for (const entry of [...items].reverse()) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'entry-row';
        const title = document.createElement('strong'),
          date = document.createElement('span');
        title.textContent = entry.feeling;
        date.textContent = formatted(entry.date);
        b.append(title, date);
        b.addEventListener('click', () => {
          selectDate(entry.date);
          if (innerWidth < 850) $('entry-section').scrollIntoView({
            behavior: reduceMotion ? 'instant' : 'smooth',
            block: 'start'
          })
        });
        list.appendChild(b);
      }
    $('export').hidden = entries.length === 0;
  }

  // Connect navigation, canvas selection, form input, and export controls.
  $('month-view').addEventListener('click', () => {
    if (!transitioning) setView('month')
  });
  $('year-view').addEventListener('click', () => {
    if (!transitioning) setView('year')
  });
  $('previous-period').addEventListener('click', () => stepPeriod(-1));
  $('next-period').addEventListener('click', () => stepPeriod(1));
  $('replay').addEventListener('click', () => {
    baseStart = performance.now();
    animations.clear();
    dirty = true
  });
  $('about').addEventListener('click', () => openIntro());
  $('intro-begin').addEventListener('click', () => $('intro-dialog').close());
  $('intro-dialog').addEventListener('click', e => {
    if (e.target === $('intro-dialog')) e.target.close()
  });
  $('intro-dialog').addEventListener('close', () => {
    if (!firstIntro) return;
    firstIntro = false;
    try {
      localStorage.setItem(INTRO_KEY, '1')
    } catch {}
    growthPaused = false;
    baseStart = performance.now();
    dirty = true;
  });
  canvas.addEventListener('pointermove', e => {
    if (mode !== 'month') return;
    const rect = canvas.getBoundingClientRect(),
      x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    const target = nearestTarget(x, y),
      day = target?.day || null;
    if (day !== hoveredDay) {
      hoveredDay = day;
      dirty = true
    }
  });
  canvas.addEventListener('pointerleave', () => {
    if (hoveredDay !== null) {
      hoveredDay = null;
      dirty = true
    }
  });
  canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect(),
      x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    if (mode === 'month') {
      const target = nearestTarget(x, y, e.pointerType === 'touch' ? 13 : 8);
      if (target) {
        const date =
          `${year}-${String(month+1).padStart(2,'0')}-${String(target.day).padStart(2,'0')}`;
        selectDate(date);
      }
    } else {
      const c = centers.find(c => Math.hypot(x - c.x, y - c.y) < c.r * 1.16);
      if (c) {
        openMonth(c.i);
        return
      }
    }
  });
  $('entry-feeling').addEventListener('change', e => {
    const other = e.target.value === 'Something else';
    $('other-field').hidden = !other;
    $('entry-other').required = other;
    $('entry-form').classList.toggle('has-other', other);
  });
  $('entry-form').addEventListener('submit', e => {
    e.preventDefault();
    const date = selectedDate;
    if (!/^202[67]-(0[1-9]|1[0-2])-[0-3][0-9]$/.test(date) || Number(date.slice(8, 10)) >
      daysInMonth(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1)) return;
    const chosen = $('entry-feeling').value;
    const feeling = (chosen === 'Something else' ? $('entry-other').value : chosen).trim();
    if (!feeling) return;
    const thought = $('entry-thought').value.trim(),
      index = entries.findIndex(item => item.date === date),
      updated = index >= 0;
    if (updated) {
      const prior = entries[index];
      entries[index] = {
        ...prior,
        feeling,
        thought,
        updatedAt: Date.now()
      };
      animations.delete(prior.id);
    } else {
      const entry = {
        id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        date,
        feeling,
        thought,
        createdAt: Date.now(),
        updatedAt: 0
      };
      entries.push(entry);
      animations.set(entry.id, performance.now());
    }
    const persisted = saveEntries();
    dirty = true;
    renderCalendar();
    renderDiary();
    renderEntries();
    $('form-status').textContent = persisted ? (updated ? 'Mark updated for this day.' :
        'Mark saved for this day.') :
      'Mark changed for this session. Browser storage is unavailable.';
  });
  $('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], {
        type: 'application/json'
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'ring-atlas-2026-2027-entries.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  new ResizeObserver(layout).observe(stage);
  growthPaused = !hasSeenIntro();
  setView('month', month);
  if (growthPaused) openIntro(true);
  requestAnimationFrame(tick);
})();
