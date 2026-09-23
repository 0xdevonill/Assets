const CONTRACT = "";

const memes = [
  { src: "images/memes/sill.png", alt: "Crumple loafs in a sunbeam on a wooden windowsill.", caption: "The sunbeam filed the paperwork." },
  { src: "images/memes/toast.png", alt: "Crumple in an oversized tuxedo raises a tiny glass of milk.", caption: "Milk, raised. Plans, declined." },
  { src: "images/memes/moon.png", alt: "Crumple loafs on a crescent moon in a mustard vest.", caption: "Even the moon is a windowsill if you commit." },
  { src: "images/memes/cloud.png", alt: "A giant Crumple loaf sits in the sky over a tiny street.", caption: "Tonight's forecast: loaf, with patches of judgment." },
  { src: "images/memes/pounce.png", alt: "Crumple is caught mid-pounce, round and delighted.", caption: "Half a second of air. A lifetime of lore." },
  { src: "images/moods/smug.png", alt: "Crumple slow-blinks in a smug loaf.", caption: "The button is a design choice." },
  { src: "images/moods/shock.png", alt: "Crumple stares in comic shock.", caption: "The beam moved. He filed an objection." },
  { src: "images/moods/sleep.png", alt: "Crumple sleeps through the afternoon.", caption: "Wake him when the beam moves." },
  { src: "images/moods/judge.png", alt: "Crumple side-eyes the room from a loaf.", caption: "Source: the cat inside the drape." },
  { src: "images/moods/wave.png", alt: "Crumple waves once with a single paw.", caption: "Community management, performed once." },
  { src: "images/moods/hold.png", alt: "Crumple lifts a tiny dumbbell and immediately regrets it.", caption: "He picked up the weight. The weight lost." },
  { src: "images/portrait.png", alt: "Portrait of Crumple, chairman of staying seated.", caption: "Meet the chairman of staying." }
];

const toast = document.querySelector("#toast");
const viewer = document.querySelector("#viewer");
const viewerImg = document.querySelector("#viewer-img");
const viewerCaption = document.querySelector("#viewer-caption");
const viewerShare = document.querySelector("#viewer-share");

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function shareUrl(caption) {
  const text = `${caption} $CRUMP — powered by pons`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

function cardMarkup(meme, extraClass) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = extraClass;
  button.innerHTML = `<img alt="${meme.alt.replaceAll('"', "&quot;")}" src="${meme.src}"><span class="card-copy"><strong>${meme.caption}</strong><small>Open meme</small></span>`;
  if (extraClass === "rail-card") {
    button.innerHTML = `<img alt="${meme.alt.replaceAll('"', "&quot;")}" src="${meme.src}"><span>${meme.caption}</span>`;
  }
  button.addEventListener("click", () => openMeme(meme));
  return button;
}

function renderMemes() {
  const features = document.querySelector("#feature-row");
  memes.slice(0, 3).forEach((meme, index) => {
    const card = cardMarkup(meme, `feature-card${index === 0 ? " lead" : ""}`);
    features.appendChild(card);
  });
  const track = document.querySelector("#rail-track");
  [...memes, ...memes].forEach((meme, index) => {
    const card = cardMarkup(meme, "rail-card");
    if (index >= memes.length) card.setAttribute("aria-hidden", "true");
    track.appendChild(card);
  });
}

function openMeme(meme) {
  viewerImg.src = meme.src;
  viewerImg.alt = meme.alt;
  viewerCaption.textContent = meme.caption;
  viewerShare.href = shareUrl(meme.caption);
  viewer.dataset.src = meme.src;
  viewer.dataset.caption = meme.caption;
  if (!viewer.open) viewer.showModal();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Caption copied");
  } catch {
    showToast("Copy blocked by the browser");
  }
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

async function downloadMeme(src, caption) {
  const image = new Image();
  image.src = src;
  await image.decode();
  const size = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const ratio = image.width / image.height;
  let sx = 0;
  let sy = 0;
  let sw = image.width;
  let sh = image.height;
  if (ratio > 1) {
    sw = image.height;
    sx = (image.width - sw) / 2;
  } else {
    sh = image.width;
    sy = (image.height - sh) / 2;
  }
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, size, size);
  const bar = 250;
  const fade = ctx.createLinearGradient(0, size - bar - 80, 0, size);
  fade.addColorStop(0, "rgba(23, 35, 63, 0)");
  fade.addColorStop(0.35, "rgba(23, 35, 63, 0.88)");
  fade.addColorStop(1, "rgba(23, 35, 63, 0.96)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, size - bar - 80, size, bar + 80);
  await document.fonts.load("620 64px Fraunces");
  ctx.fillStyle = "#fffaf3";
  ctx.font = "620 58px Fraunces, Georgia, serif";
  const lines = wrapText(ctx, caption, size - 120);
  lines.forEach((line, index) => {
    ctx.fillText(line, 60, size - 150 + index * 66);
  });
  ctx.font = "700 28px Outfit, sans-serif";
  ctx.fillStyle = "#f2c14b";
  ctx.fillText("$CRUMP  ·  powered by pons", 60, size - 48);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const slug = caption.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  link.href = url;
  link.download = `crumple-${slug || "meme"}.png`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Meme saved");
}

function captionFrom(article) {
  return article.querySelector("h3").textContent.trim();
}

function imageFrom(article) {
  return article.querySelector("img").getAttribute("src");
}

function setupMoods() {
  const buttons = [...document.querySelectorAll("[data-filter]")];
  const cards = [...document.querySelectorAll(".mood")];
  const empty = document.querySelector("#mood-empty");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      const filter = button.dataset.filter;
      let shown = 0;
      cards.forEach((card) => {
        const tags = card.dataset.tags.split(" ");
        const visible = filter === "all" || tags.includes(filter);
        card.hidden = !visible;
        if (visible) shown += 1;
      });
      empty.hidden = shown !== 0;
    });
  });

  document.querySelectorAll(".mood").forEach((article) => {
    article.querySelector("[data-copy]").addEventListener("click", () => {
      copyText(`${captionFrom(article)} $CRUMP — powered by pons`);
    });
    article.querySelector("[data-download]").addEventListener("click", () => {
      downloadMeme(imageFrom(article), captionFrom(article));
    });
  });
}

function setupContract() {
  const valid = /^0x[a-fA-F0-9]{40}$/.test(CONTRACT);
  if (!valid) return;
  const code = document.querySelector("#contract-value");
  const copy = document.querySelector("#copy-contract");
  const note = document.querySelector("#trade-note");
  const href = `https://www.ponsfamily.com/launchpad/${CONTRACT}`;
  code.textContent = CONTRACT;
  copy.disabled = false;
  copy.textContent = "Copy";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(CONTRACT);
      showToast("Address copied");
    } catch {
      showToast("Copy blocked by the browser");
    }
  });
  ["#trade-link", "#trade-link-2"].forEach((selector) => {
    const link = document.querySelector(selector);
    link.href = href;
    link.textContent = selector === "#trade-link" ? "Trade on pons" : "Open the $CRUMP market";
  });
  note.textContent = "Trade only if this address matches the token page on pons, character for character.";
  document.querySelector(".ledger-top span:last-child").textContent = "Address published";
}

function setupChrome() {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector("#site-nav");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!open));
    nav.classList.toggle("open", !open);
    toggle.textContent = open ? "Menu" : "Close";
  });
  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "Menu";
    });
  });

  const replies = [
    "Request denied. He has become furniture.",
    "He sat down harder, out of spite.",
    "Standing is a rumor. He will not confirm it.",
    "The vest voted no."
  ];
  let replyIndex = 0;
  const frame = document.querySelector("#hero-frame");
  document.querySelector("#ask-stand").addEventListener("click", () => {
    frame.classList.remove("shoved");
    void frame.offsetWidth;
    frame.classList.add("shoved");
    document.querySelector("#ask-reply").textContent = replies[replyIndex % replies.length];
    replyIndex += 1;
  });

  document.querySelector("#print-meme").addEventListener("click", () => {
    openMeme(memes[Math.floor(Math.random() * memes.length)]);
  });
  document.querySelector("#viewer-copy").addEventListener("click", () => {
    copyText(`${viewer.dataset.caption} $CRUMP — powered by pons`);
  });
  document.querySelector("#viewer-download").addEventListener("click", () => {
    downloadMeme(viewer.dataset.src, viewer.dataset.caption);
  });
}

renderMemes();
setupMoods();
setupContract();
setupChrome();
