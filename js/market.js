const RPC = "https://rpc.mainnet.chain.robinhood.com";
const CHAIN_ID = "0x1237";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const ZERO = "0x0000000000000000000000000000000000000000";

const SEL = {
  curve: "0x7165485d",
  launchFactory: "0x536dac9b",
  totalSupply: "0x18160ddd",
  decimals: "0x313ce567",
  symbol: "0x95d89b41",
  balanceOf: "0x70a08231",
  getLaunchedToken: "0x3cf28b5a",
  feeBps: "0x24a9d853",
  creatorTaxBps: "0xc1bb8901",
  pairToken: "0x3de35b79",
  pairDecimals: "0xc9b58ec7",
  k: "0xb4f40c61",
  quoteReserve: "0x9da771f4",
  tokenReserve: "0xcbcb3171",
  graduated: "0xe7c2b772",
  buybackEnabled: "0x160d0da5",
  feeEscrow: "0xc4b7de97",
  getLaunchFeePolicy: "0x470ef5fc",
  balanceOfToken: "0xf59e38b7",
  buy: "0x59a87bc1",
  sell: "0xd04c6983",
  approve: "0x095ea7b3",
  allowance: "0xdd62ed3e"
};

const $ = (id) => document.getElementById(id);
let marketTimer = 0;
let market = null;

function padAddress(address) {
  return address.toLowerCase().replace("0x", "").padStart(64, "0");
}

function padWord(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function wordAddress(word) {
  return `0x${word.slice(24)}`;
}

function decodeString(hex) {
  if (!hex || hex === "0x") return "";
  const data = hex.slice(2);
  if (data.length < 128) {
    const raw = data.replace(/00+$/, "");
    return raw ? decodeURIComponent(raw.replace(/(..)/g, "%$1")) : "";
  }
  const offset = Number(BigInt(`0x${data.slice(0, 64)}`)) * 2;
  const length = Number(BigInt(`0x${data.slice(offset, offset + 64)}`));
  const raw = data.slice(offset + 64, offset + 64 + length * 2);
  const bytes = new Uint8Array(raw.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)));
  return new TextDecoder().decode(bytes);
}

async function ethCall(to, data) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] })
  });
  const json = await response.json();
  if (json.error) throw new Error(json.error.message || "RPC error");
  return json.result;
}

async function tryCall(to, data) {
  try {
    const result = await ethCall(to, data);
    if (!result || result === "0x") return null;
    return result;
  } catch {
    return null;
  }
}

function parseUnits(text, decimals) {
  const cleaned = text.trim();
  if (!cleaned) return 0n;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const padded = `${fraction}${"0".repeat(decimals)}`.slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

function formatUnits(value, decimals, digits = 2) {
  const negative = value < 0n;
  const amount = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = amount % base;
  const fractionText = fraction.toString().padStart(Number(decimals), "0").slice(0, digits).replace(/0+$/, "");
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${wholeText}${fractionText ? `.${fractionText}` : ""}`;
}

function formatUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (number >= 1e9) return `$${(number / 1e9).toFixed(2)}B`;
  if (number >= 1e6) return `$${(number / 1e6).toFixed(2)}M`;
  if (number >= 1e3) return `$${(number / 1e3).toFixed(2)}K`;
  if (number >= 1) return `$${number.toFixed(2)}`;
  if (number === 0) return "$0";
  return `$${number.toPrecision(3)}`;
}

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function creatorShareBps(state) {
  const fee = BigInt(state.feeBps);
  const tax = BigInt(state.creatorTaxBps);
  const protocol = (fee * BigInt(state.protocolShareBps)) / 10000n;
  let remainder = fee - protocol;
  if (state.buybackEnabled) {
    remainder -= (remainder * BigInt(state.buybackShareBps)) / 10000n;
  }
  return remainder + tax;
}

function quoteBuy(amountIn, state) {
  const grossFee = (amountIn * BigInt(state.feeBps)) / 10000n;
  const tax = (amountIn * BigInt(state.creatorTaxBps)) / 10000n;
  const net = amountIn - grossFee - tax;
  if (net <= 0n) return 0n;
  const newX = state.quoteReserve + net;
  const newY = state.k / newX;
  return newY >= state.tokenReserve ? 0n : state.tokenReserve - newY;
}

function quoteSell(tokensIn, state) {
  const newY = state.tokenReserve + tokensIn;
  const newX = state.k / newY;
  const grossOut = state.quoteReserve - newX;
  const fee = (grossOut * BigInt(state.feeBps)) / 10000n;
  const tax = (grossOut * BigInt(state.creatorTaxBps)) / 10000n;
  const out = grossOut - fee - tax;
  return out > 0n ? out : 0n;
}

function setWaiting() {
  ["chart-price", "stat-volume", "stat-creator", "stat-burn", "stat-price", "swap-out"].forEach((id) => {
    $(id).textContent = "—";
  });
  $("chart-change").textContent = "";
  $("chart-note").textContent = "Add the contract address in js/site.js. This desk reads that address and nothing else.";
  $("stat-volume-note").textContent = "24h volume across indexed pools";
  $("stat-creator-note").textContent = "Creator share of each trade";
  $("stat-burn-note").textContent = "Supply removed and burn-address balance";
  $("stat-price-note").textContent = "Live price";
  $("swap-status").textContent = "The swap stays closed until the ledger has an address.";
  $("swap-button").disabled = true;
  drawChart([]);
}

function drawChart(candles) {
  const canvas = $("price-chart");
  const width = canvas.clientWidth || 640;
  const height = 320;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fffaf3";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(26,20,15,0.08)";
  ctx.lineWidth = 1;
  for (let row = 1; row < 4; row += 1) {
    const y = (height / 4) * row;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  if (!candles.length) {
    ctx.fillStyle = "#5c5146";
    ctx.font = "600 16px Outfit, sans-serif";
    ctx.fillText("Waiting for trades", 24, height / 2);
    return;
  }
  const closes = candles.map((candle) => candle.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || max * 0.02 || 1;
  const pad = 18;
  ctx.beginPath();
  closes.forEach((close, index) => {
    const x = pad + (index / Math.max(closes.length - 1, 1)) * (width - pad * 2);
    const y = height - pad - ((close - min) / span) * (height - pad * 2);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#17233f";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  const lastUp = closes[closes.length - 1] >= closes[0];
  ctx.strokeStyle = lastUp ? "#2f6a45" : "#ef3b22";
  ctx.stroke();
}

async function loadPairs(token) {
  const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${token}`);
  if (!response.ok) return [];
  const body = await response.json();
  const pairs = Array.isArray(body) ? body : body.pairs || [];
  return pairs.filter((pair) => {
    const base = pair.baseToken?.address?.toLowerCase();
    const quote = pair.quoteToken?.address?.toLowerCase();
    const mine = token.toLowerCase();
    return base === mine || quote === mine;
  });
}

async function loadCandles(pairAddress, range) {
  const url = `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${pairAddress}/ohlcv/${range.frame}?aggregate=${range.aggregate}&limit=80`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const body = await response.json();
  const list = body?.data?.attributes?.ohlcv_list || [];
  return list
    .map((row) => ({ time: row[0], open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] }))
    .reverse();
}

async function readCurve(token) {
  const curveHex = await tryCall(token, SEL.curve);
  if (!curveHex) return null;
  const curve = wordAddress(curveHex.slice(2));
  if (/^0x0{40}$/.test(curve)) return null;
  const [fee, tax, pair, decimals, reserve, tokens, kValue, done, buyback] = await Promise.all([
    tryCall(curve, SEL.feeBps),
    tryCall(curve, SEL.creatorTaxBps),
    tryCall(curve, SEL.pairToken),
    tryCall(curve, SEL.pairDecimals),
    tryCall(curve, SEL.quoteReserve),
    tryCall(curve, SEL.tokenReserve),
    tryCall(curve, SEL.k),
    tryCall(curve, SEL.graduated),
    tryCall(curve, SEL.buybackEnabled)
  ]);
  if (!fee) return null;
  const quoteReserve = BigInt(reserve || "0x0");
  const tokenReserve = BigInt(tokens || "0x0");
  let k = kValue ? BigInt(kValue) : 0n;
  if (k === 0n && quoteReserve > 0n && tokenReserve > 0n) k = quoteReserve * tokenReserve;
  return {
    curve,
    feeBps: Number(BigInt(fee)),
    creatorTaxBps: Number(BigInt(tax || "0x0")),
    pairToken: wordAddress((pair || `0x${"0".repeat(64)}`).slice(2)),
    pairDecimals: Number(BigInt(decimals || "0x12")),
    quoteReserve,
    tokenReserve,
    k,
    graduated: BigInt(done || "0x0") === 1n,
    buybackEnabled: BigInt(buyback || "0x0") === 1n
  };
}

async function readLaunch(token) {
  const factoryHex = await tryCall(token, SEL.launchFactory);
  const factory = factoryHex ? wordAddress(factoryHex.slice(2)) : "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
  const launchHex = await tryCall(factory, SEL.getLaunchedToken + padAddress(token));
  if (!launchHex || launchHex.length < 2 + 64 * 5) return null;
  const words = launchHex.slice(2).match(/.{64}/g);
  if (BigInt(`0x${words[words.length - 1]}`) !== 1n) return null;
  const policyHex = await tryCall(factory, SEL.getLaunchFeePolicy + padAddress(token));
  const policy = policyHex ? policyHex.slice(2).match(/.{64}/g) : [];
  const escrowHex = await tryCall(factory, SEL.feeEscrow);
  return {
    factory,
    creator: wordAddress(words[3]),
    pairToken: wordAddress(words[4]),
    protocolShareBps: policy[1] ? Number(BigInt(`0x${policy[1]}`)) : 0,
    buybackShareBps: policy[2] ? Number(BigInt(`0x${policy[2]}`)) : 0,
    escrow: escrowHex ? wordAddress(escrowHex.slice(2)) : ZERO
  };
}

async function readBurn(token, decimals, curve) {
  const [supplyHex, deadHex, zeroHex] = await Promise.all([
    ethCall(token, SEL.totalSupply),
    ethCall(token, SEL.balanceOf + padAddress(DEAD)),
    ethCall(token, SEL.balanceOf + padAddress(ZERO))
  ]);
  const supply = BigInt(supplyHex);
  const parked = BigInt(deadHex) + BigInt(zeroHex);
  let destroyed = 0n;
  if (curve) {
    const phantomHex = await tryCall(curve.curve, "0xc57eadfc");
    if (phantomHex && BigInt(phantomHex) > 0n) {
      const initial = curve.k / BigInt(phantomHex);
      if (initial > supply) destroyed = initial - supply;
    }
  }
  return { supply, burned: destroyed + parked, destroyed, parked };
}

async function readCreator(state) {
  if (!state.launch) return null;
  const share = creatorShareBps({
    feeBps: state.curve?.feeBps || 0,
    creatorTaxBps: state.curve?.creatorTaxBps || 0,
    protocolShareBps: state.launch.protocolShareBps || 0,
    buybackShareBps: state.launch.buybackShareBps || 0,
    buybackEnabled: Boolean(state.curve?.buybackEnabled)
  });
  const pair = state.curve?.pairToken || state.launch.pairToken;
  const native = !pair || /^0x0{40}$/.test(pair);
  const data = native
    ? SEL.balanceOf + padAddress(state.launch.creator)
    : SEL.balanceOfToken + padAddress(state.launch.creator) + padAddress(pair);
  const dueHex = await tryCall(state.launch.escrow, data);
  return {
    shareBps: share,
    unclaimed: dueHex ? BigInt(dueHex) : 0n,
    creator: state.launch.creator
  };
}

function bestPair(pairs, token) {
  return [...pairs].sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0] || null;
}

function renderStats(state) {
  const pair = bestPair(state.pairs, state.token);
  const volume = state.pairs.reduce((sum, item) => {
    const base = item.baseToken?.address?.toLowerCase();
    return sum + (base === state.token.toLowerCase() ? item.volume?.h24 || 0 : 0);
  }, 0);
  $("stat-volume").textContent = state.pairs.length ? formatUsd(volume) : "No trades yet";
  $("stat-volume-note").textContent = state.pairs.length ? "Trailing 24h on indexed Robinhood pools" : "DexScreener has not indexed a pool yet";

  if (state.creator) {
    $("stat-creator").textContent = `${(Number(state.creator.shareBps) / 100).toFixed(2)}%`;
    const dueDecimals = state.curve && !/^0x0{40}$/.test(state.curve.pairToken) ? state.curve.pairDecimals : 18;
    const dueSymbol = state.quoteSymbol || "ETH";
    $("stat-creator-note").textContent = `Unclaimed ${formatUnits(state.creator.unclaimed, dueDecimals, 4)} ${dueSymbol} · ${shortAddress(state.creator.creator)}`;
  } else {
    $("stat-creator").textContent = "No pons fee";
    $("stat-creator-note").textContent = "This address has no pons creator commission record";
  }

  $("stat-burn").textContent = `${formatUnits(state.burn.burned, state.decimals, 2)} ${state.symbol}`;
  $("stat-burn-note").textContent = `${formatUnits(state.burn.destroyed, state.decimals, 2)} removed from supply · ${formatUnits(state.burn.parked, state.decimals, 2)} in burn addresses`;
  $("fact-supply").textContent = formatUnits(state.burn.supply, state.decimals, 2);

  const priceUsd = pair ? Number(pair.priceUsd) : null;
  if (priceUsd) {
    $("stat-price").textContent = formatUsd(priceUsd);
    $("chart-price").textContent = formatUsd(priceUsd);
    const change = pair.priceChange?.h24;
    $("chart-change").textContent = Number.isFinite(change) ? `${change > 0 ? "+" : ""}${change.toFixed(2)}% 24h` : "";
    $("chart-change").style.color = change < 0 ? "#ef3b22" : "#2f6a45";
    $("stat-price-note").textContent = pair.quoteToken?.symbol ? `Quoted in ${pair.quoteToken.symbol}` : "Indexed pool";
  } else if (state.curve && state.curve.tokenReserve > 0n) {
    const quote = Number(state.curve.quoteReserve) / 10 ** state.curve.pairDecimals;
    const tokens = Number(state.curve.tokenReserve) / 10 ** state.decimals;
    const price = tokens ? quote / tokens : 0;
    $("stat-price").textContent = `${price.toPrecision(4)} ${state.quoteSymbol}`;
    $("chart-price").textContent = $("stat-price").textContent;
    $("chart-change").textContent = state.curve.graduated ? "Graduated" : "On the curve";
    $("stat-price-note").textContent = "Curve price";
  }
  $("fact-quote").textContent = state.quoteSymbol || "ETH";
}

async function refreshChart() {
  if (!market?.pair) {
    drawChart([]);
    $("chart-note").textContent = "No indexed pool yet. Price still updates from the contract when the curve is open.";
    return;
  }
  const active = document.querySelector("#chart-ranges button[aria-pressed='true']");
  const range = { frame: active.dataset.frame, aggregate: active.dataset.aggregate };
  const candles = await loadCandles(market.pair.pairAddress, range);
  market.candles = candles;
  drawChart(candles);
  $("chart-note").textContent = candles.length
    ? `${market.pair.dexId} · ${market.pair.baseToken.symbol}/${market.pair.quoteToken.symbol}`
    : "The pool is indexed, but candle history is not back yet.";
}

function updateSwapQuote() {
  if (!market) return;
  const buying = $("swap-side").dataset.side !== "sell";
  const amount = parseUnits($("swap-amount").value, buying ? market.payDecimals : market.decimals);
  if (amount === null) {
    $("swap-out").textContent = "Check the amount";
    return;
  }
  if (amount === 0n) {
    $("swap-out").textContent = "0";
    return;
  }
  let out = 0n;
  let outDecimals = buying ? market.decimals : market.payDecimals;
  if (market.curve && !market.curve.graduated) {
    out = buying ? quoteBuy(amount, market.curve) : quoteSell(amount, market.curve);
    $("swap-status").textContent = "Quote comes from the pons curve. You sign it in your wallet.";
  } else if (market.priceQuote > 0) {
    const pay = Number(amount) / 10 ** (buying ? market.payDecimals : market.decimals);
    const received = buying ? pay / market.priceQuote : pay * market.priceQuote;
    $("swap-out").textContent = `${received.toPrecision(6)} ${buying ? market.symbol : market.quoteSymbol}`;
    $("swap-status").textContent = "The curve has graduated. This is the indexed pool price. Swap opens that pool.";
    return;
  } else {
    $("swap-out").textContent = "No pool price yet";
    return;
  }
  $("swap-out").textContent = `${formatUnits(out, outDecimals, 4)} ${buying ? market.symbol : market.quoteSymbol}`;
}

async function ensureChain() {
  const ethereum = window.ethereum;
  if (!ethereum) throw new Error("Open this page in a wallet browser, or install one.");
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID }] });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: CHAIN_ID,
        chainName: "Robinhood Chain",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: [RPC],
        blockExplorerUrls: ["https://robinhoodchain.blockscout.com"]
      }]
    });
  }
  $("wallet-button").textContent = shortAddress(accounts[0]);
  return accounts[0];
}

async function sendSwap() {
  const account = await ensureChain();
  const buying = $("swap-side").dataset.side !== "sell";
  const amount = parseUnits($("swap-amount").value, buying ? market.payDecimals : market.decimals);
  if (!amount) throw new Error("Enter an amount first.");
  const slippage = Math.round(Number($("swap-slip").value || "5") * 100);
  if (!Number.isFinite(slippage) || slippage < 0 || slippage > 5000) throw new Error("Slippage must be between 0 and 50.");

  if (!market.curve || market.curve.graduated) {
    const input = buying ? (market.nativeQuote ? "ETH" : market.curve?.pairToken || "ETH") : market.token;
    const output = buying ? market.token : (market.nativeQuote ? "ETH" : market.curve?.pairToken || "ETH");
    const url = `https://app.uniswap.org/swap?chain=robinhood&inputCurrency=${input}&outputCurrency=${output}`;
    window.open(url, "_blank", "noopener");
    $("swap-status").textContent = "Wallet is on Robinhood Chain. Finish the swap on the indexed pool.";
    return;
  }

  const quoted = buying ? quoteBuy(amount, market.curve) : quoteSell(amount, market.curve);
  const minimum = (quoted * BigInt(10000 - slippage)) / 10000n;
  const ethereum = window.ethereum;
  if (!buying || !market.nativeQuote) {
    const spendToken = buying ? market.curve.pairToken : market.token;
    const allowanceHex = await ethCall(spendToken, SEL.allowance + padAddress(account) + padAddress(market.curve.curve));
    if (BigInt(allowanceHex) < amount) {
      await ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from: account, to: spendToken, data: SEL.approve + padAddress(market.curve.curve) + padWord(amount), value: "0x0" }]
      });
    }
  }
  const data = (buying ? SEL.buy : SEL.sell) + padWord(amount) + padWord(minimum) + padAddress(account);
  await ethereum.request({
    method: "eth_sendTransaction",
    params: [{
      from: account,
      to: market.curve.curve,
      data,
      value: buying && market.nativeQuote ? `0x${amount.toString(16)}` : "0x0"
    }]
  });
  $("swap-status").textContent = "Transaction sent. The curve will fill it if the quote still holds.";
}

async function loadMarket(token) {
  const [pairs, symbolHex, decimalsHex, curve, launch] = await Promise.all([
    loadPairs(token),
    tryCall(token, SEL.symbol),
    tryCall(token, SEL.decimals),
    readCurve(token),
    readLaunch(token)
  ]);
  const decimals = decimalsHex ? Number(BigInt(decimalsHex)) : 18;
  const symbol = symbolHex ? decodeString(symbolHex) : "CRUMP";
  const burn = await readBurn(token, decimals, curve);
  let quoteSymbol = "ETH";
  let payDecimals = 18;
  let nativeQuote = true;
  if (curve && !/^0x0{40}$/.test(curve.pairToken)) {
    nativeQuote = false;
    payDecimals = curve.pairDecimals;
    const quoteSymbolHex = await tryCall(curve.pairToken, SEL.symbol);
    quoteSymbol = quoteSymbolHex ? decodeString(quoteSymbolHex) : "QUOTE";
  }
  const pair = bestPair(pairs, token);
  const priceQuote = pair ? Number(pair.priceNative) : 0;
  const creator = curve || launch ? await readCreator({ token, curve, launch, quoteSymbol }) : null;
  market = { token, pairs, pair, curve, launch, creator, burn, decimals, symbol, quoteSymbol, payDecimals, nativeQuote, priceQuote };
  renderStats(market);
  $("swap-button").disabled = false;
  $("swap-pay-label").textContent = `You pay (${$("swap-side").dataset.side === "sell" ? symbol : quoteSymbol})`;
  $("swap-receive-label").textContent = `You receive (${$("swap-side").dataset.side === "sell" ? quoteSymbol : symbol})`;
  $("chart-note").textContent = "Loading candles…";
  await refreshChart();
  updateSwapQuote();
  if (!market.curve || market.curve.graduated) {
    $("swap-status").textContent = "Graduated pool. Connect a wallet, then swap opens this contract on the indexed market.";
  } else {
    $("swap-status").textContent = "The pons curve is still open. The quote is the contract math, and the swap is signed in your wallet.";
  }
  $("launch-state").textContent = "Live";
  $("launch-state").classList.add("hot");
}

function bindMarket() {
  document.querySelectorAll("#chart-ranges button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#chart-ranges button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      refreshChart().catch(() => {
        $("chart-note").textContent = "Candle request failed. The other numbers are still live.";
      });
    });
  });
  $("swap-side").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    $("swap-side").dataset.side = button.dataset.side;
    $("swap-side").querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    if (market) {
      $("swap-pay-label").textContent = `You pay (${button.dataset.side === "sell" ? market.symbol : market.quoteSymbol})`;
      $("swap-receive-label").textContent = `You receive (${button.dataset.side === "sell" ? market.quoteSymbol : market.symbol})`;
    }
    updateSwapQuote();
  });
  $("swap-amount").addEventListener("input", updateSwapQuote);
  $("wallet-button").addEventListener("click", () => {
    ensureChain().catch((error) => {
      $("swap-status").textContent = error.message || "Wallet request failed.";
    });
  });
  $("swap-button").addEventListener("click", () => {
    sendSwap().catch((error) => {
      $("swap-status").textContent = error.message || "Swap was not sent.";
    });
  });
  window.addEventListener("resize", () => drawChart(market?.candles || []));
}

window.startCrumpMarket = function startCrumpMarket(token) {
  clearInterval(marketTimer);
  if (!/^0x[a-fA-F0-9]{40}$/.test(token)) {
    market = null;
    setWaiting();
    return;
  }
  const run = () => loadMarket(token).catch((error) => {
    $("chart-note").textContent = error.message || "The chain did not answer.";
  });
  run();
  marketTimer = setInterval(run, 30000);
};

bindMarket();
setWaiting();
if (window.bootMarket) window.bootMarket();
