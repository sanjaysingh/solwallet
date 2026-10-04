import {
    DEFAULT_NETWORK_ID,
    clusterFromGenesisHash,
    formatAddressShort,
    getNetworkFromSearch,
    buildUrlWithNetwork,
    getTxExplorerUrl as buildTxExplorerUrl,
    lamportsToSol,
    solToLamports,
    uiToRaw,
    GENESIS_HASHES,
} from './utils.js?v=__CACHE_VERSION__';
import {
    accountsFromSecret,
    formatSecretKey,
    generateMnemonicPhrase,
    generatePrivateKeySecret,
} from './keys.js?v=__CACHE_VERSION__';
import {
    createPasskeyWallet,
    isPasskeyCancellation,
    isPasskeySupported,
    passkeyErrorMessage,
    unlockPasskeyWallet,
} from './passkey.js?v=__CACHE_VERSION__';
import {
    PRICE_RPC_URL,
    fetchSolUsdPrice,
    formatTokenUsd,
    usdPriceForSymbol,
} from './price.js?v=__CACHE_VERSION__';
import {
    confirmSignature,
    getAccountInfo,
    getBalance,
    getFeeForMessage,
    getGenesisHash,
    getLatestBlockhash,
    getMinimumBalanceForRentExemption,
    getTokenAccountsByOwner,
    sendTransaction as rpcSendTransaction,
    simulateTransaction,
} from './rpc.js?v=__CACHE_VERSION__';
import {
    FAUCET_TURNSTILE_SITE_KEY,
    isFaucetNetwork,
    isFaucetTurnstileAlreadyMounted,
    requestFaucetDrip,
    shouldMountFaucetTurnstileOnNetworkChange,
} from './faucet.js?v=__CACHE_VERSION__';
import {
    assertFeeLeavesRent,
    assertSolTransferAffordable,
    associatedTokenAddress,
    buildAndSignSolTransfer,
    buildAndSignSplTransfer,
    bytesToBase64,
    decodePublicKey,
    encodePublicKey,
    signatureBase58,
} from './tx.js?v=__CACHE_VERSION__';

const { createApp, ref, watch, onMounted, computed, nextTick } = Vue;

createApp({
    setup() {
        const selectedNetwork = ref(DEFAULT_NETWORK_ID);
        const rpcEndpoint = ref('https://api.devnet.solana.com');
        const seedPhrase = ref('');
        const seedVisible = ref(false);
        const previousSessions = ref([]);
        const selectedPreviousSession = ref('');

        const availableNetworks = ref([
            {
                id: 'devnet',
                name: 'Devnet',
                rpcUrl: 'https://api.devnet.solana.com',
                isTestnet: true,
            },
            {
                id: 'testnet',
                name: 'Testnet',
                rpcUrl: 'https://api.testnet.solana.com',
                isTestnet: true,
            },
            {
                id: 'mainnet',
                name: 'Mainnet',
                rpcUrl: 'https://solana-rpc.publicnode.com',
                isTestnet: false,
            },
            {
                id: 'custom',
                name: 'Custom',
                rpcUrl: '',
            },
        ]);

        const testnetNetworks = computed(() =>
            availableNetworks.value.filter((network) => network.id !== 'custom' && network.isTestnet)
        );
        const mainnetNetworks = computed(() =>
            availableNetworks.value.filter((network) => network.id !== 'custom' && !network.isTestnet)
        );

        const error = ref('');
        const accounts = ref([]);
        const selectedFromAddress = ref('');
        const tokenType = ref('native');
        const chainInfo = ref({ name: 'Devnet', nativeSymbol: 'SOL' });
        const tokenAddress = ref('');
        const toAddress = ref('');
        const amount = ref('');
        const txStatus = ref('');
        const txStatusType = ref('');
        const txExplorerUrl = ref('');
        const estimatedFee = ref('');
        const tokenInfo = ref(null);
        let txStatusTimeout = null;

        const currentTheme = ref('dark');
        const isLoading = ref(false);
        const alerts = ref([]);
        const showWalletManagement = ref(true);
        const sessionPanelOpen = ref(false);
        const networkStatusText = ref('');
        const networkStatusClass = ref('network-status text-muted');
        const isPrivateKeyVisible = ref(false);
        const originalSeedInput = ref('');
        const walletSource = ref('');
        const passkeysSupported = ref(false);
        let pendingWalletSource = '';

        const walletRecords = [];
        const isWalletInitialized = ref(false);

        const faucetAvailable = computed(() => isFaucetNetwork(selectedNetwork.value));
        const faucetTurnstileEl = ref(null);
        const faucetTurnstileToken = ref('');
        const faucetTurnstileWidgetId = ref(null);
        const faucetLoading = ref(false);
        const faucetBusyAddress = ref('');
        const faucetStatus = ref('');
        const faucetStatusOk = ref(false);
        const faucetExplorerUrl = ref('');

        const getNetworkName = () => {
            const network = availableNetworks.value.find((item) => item.id === selectedNetwork.value);
            return network ? network.name : 'Unknown';
        };

        const updateUrlWithNetwork = (networkId) => {
            const nextUrl = buildUrlWithNetwork(window.location.href, networkId, DEFAULT_NETWORK_ID);
            window.history.replaceState({}, '', nextUrl);
        };

        const formatSecretShort = (secret) => {
            if (!secret || secret.length < 10) return secret || '***';
            return `${secret.substring(0, 6)}...${secret.substring(secret.length - 6)}`;
        };

        const currentPrivateKeyDisplay = computed(() => {
            if (!originalSeedInput.value || originalSeedInput.value.length < 10) return '***';
            if (isPrivateKeyVisible.value) {
                return originalSeedInput.value;
            }
            return formatSecretShort(originalSeedInput.value);
        });

        let currentAlertTimeout = null;

        const showAlert = (message, type = 'info') => {
            const id = Date.now();
            if (currentAlertTimeout) {
                clearTimeout(currentAlertTimeout);
            }
            alerts.value = [{ message, type, id }];
            currentAlertTimeout = setTimeout(() => {
                dismissAlert(id);
                currentAlertTimeout = null;
            }, 4000);
        };

        const dismissAlert = (id) => {
            alerts.value = id ? alerts.value.filter((alert) => alert.id !== id) : [];
        };

        const toggleTheme = () => {
            currentTheme.value = currentTheme.value === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-bs-theme', currentTheme.value);
        };

        const updateWalletStateUI = () => {
            showWalletManagement.value = !isWalletInitialized.value;
            if (!isWalletInitialized.value) {
                sessionPanelOpen.value = false;
            }
        };

        const toggleSessionPanel = () => {
            sessionPanelOpen.value = !sessionPanelOpen.value;
        };

        const formatAccountBalance = (balance) => {
            const n = Number(balance);
            if (!Number.isFinite(n)) {
                return '0';
            }
            return String(Number.parseFloat(n.toFixed(6)));
        };

        const nativeUsdPrices = ref({});
        let lastNativeUsdPriceFetchAt = 0;
        const NATIVE_USD_PRICE_CACHE_MS = 60_000;

        const nativeUsdPrice = computed(() =>
            usdPriceForSymbol(nativeUsdPrices.value, chainInfo.value?.nativeSymbol)
        );

        const formatAccountUsd = (balance) => formatTokenUsd(balance, nativeUsdPrice.value);

        const totalBalance = computed(() => {
            const sum = accounts.value.reduce((acc, account) => acc + Number(account.balance || 0), 0);
            return formatAccountBalance(sum);
        });

        const totalBalanceUsd = computed(() => {
            const sum = accounts.value.reduce((acc, account) => acc + Number(account.balance || 0), 0);
            return formatAccountUsd(sum);
        });

        const refreshNativeUsdPrices = async ({ force = false } = {}) => {
            const now = Date.now();
            if (
                !force &&
                now - lastNativeUsdPriceFetchAt < NATIVE_USD_PRICE_CACHE_MS &&
                usdPriceForSymbol(nativeUsdPrices.value, 'SOL') != null
            ) {
                return;
            }
            try {
                const prices = await fetchSolUsdPrice({ rpcUrl: PRICE_RPC_URL });
                if (prices && Object.keys(prices).length > 0) {
                    nativeUsdPrices.value = prices;
                    lastNativeUsdPriceFetchAt = now;
                }
            } catch (err) {
                console.error('Failed to fetch USD prices:', err);
            }
        };

        const applyChainInfo = () => {
            chainInfo.value = { name: getNetworkName(), nativeSymbol: 'SOL' };
        };

        const refreshNetworkStatus = async () => {
            applyChainInfo();
            const label = getNetworkName();
            if (!rpcEndpoint.value) {
                networkStatusText.value = `${label} · enter an RPC URL`;
                networkStatusClass.value = 'network-status text-muted';
                return;
            }
            try {
                const hash = await getGenesisHash(rpcEndpoint.value);
                if (selectedNetwork.value === 'custom') {
                    const known = clusterFromGenesisHash(hash);
                    networkStatusText.value = known ? `Custom · connected (${known})` : 'Custom · connected';
                    networkStatusClass.value = 'network-status text-primary';
                    return;
                }
                if (hash === GENESIS_HASHES[selectedNetwork.value]) {
                    networkStatusText.value = `${label} · connected`;
                    networkStatusClass.value = 'network-status text-primary';
                } else {
                    networkStatusText.value = `${label} · RPC does not match this cluster`;
                    networkStatusClass.value = 'network-status text-warning';
                }
            } catch (err) {
                console.error('RPC check failed:', err);
                networkStatusText.value = `${label} · RPC unreachable`;
                networkStatusClass.value = 'network-status text-danger';
            }
        };

        const showError = (message) => {
            error.value = message;
            setTimeout(() => {
                error.value = '';
            }, 5000);
        };

        const toggleSeedVisibility = () => {
            seedVisible.value = !seedVisible.value;
        };

        const toggleCurrentPrivateKeyVisibility = () => {
            isPrivateKeyVisible.value = !isPrivateKeyVisible.value;
        };

        const copyButtonFromEvent = (event) => {
            if (!event) {
                return null;
            }
            if (event.currentTarget && typeof event.currentTarget.closest === 'function') {
                return event.currentTarget.closest('button') || event.currentTarget;
            }
            if (event.target && typeof event.target.closest === 'function') {
                return event.target.closest('button');
            }
            if (event.target && event.target.parentElement) {
                return event.target.parentElement.closest('button');
            }
            return null;
        };

        const isAppleTouchDevice = () => {
            const ua = navigator.userAgent || '';
            return /iPad|iPhone|iPod/i.test(ua)
                || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        };

        const copyTextWithExecCommand = (text) => {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.setAttribute('aria-hidden', 'true');
            textarea.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0.01;font-size:16px;';
            document.body.appendChild(textarea);

            const selection = window.getSelection();
            const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
            let copied = false;
            const onCopy = (event) => {
                if (!event.clipboardData) {
                    return;
                }
                event.clipboardData.setData('text/plain', text);
                event.preventDefault();
                copied = true;
            };
            document.addEventListener('copy', onCopy);
            try {
                textarea.focus();
                textarea.select();
                textarea.setSelectionRange(0, text.length);
                copied = document.execCommand('copy') || copied;
            } catch {
                copied = copied || false;
            } finally {
                document.removeEventListener('copy', onCopy);
                document.body.removeChild(textarea);
                if (selection) {
                    selection.removeAllRanges();
                    if (previousRange) {
                        selection.addRange(previousRange);
                    }
                }
            }
            return copied;
        };

        const showCopySuccess = (button) => {
            if (!button || !button.classList) {
                return;
            }
            const icon = button.querySelector('i');
            const originalIconClasses = icon ? icon.className : '';
            const originalButtonClasses = button.className;
            if (icon) {
                icon.className = 'bi bi-check-lg';
            }
            button.classList.remove('btn-outline-secondary');
            button.classList.add('btn-success');
            setTimeout(() => {
                if (icon) {
                    icon.className = originalIconClasses;
                }
                button.className = originalButtonClasses;
            }, 2000);
        };

        const copyText = (text, event, failMessage) => {
            if (!text) {
                return false;
            }
            const button = copyButtonFromEvent(event);
            const succeed = () => showCopySuccess(button);
            const fail = (err) => {
                console.error('Failed to copy:', err);
                showAlert(failMessage, 'warning');
            };
            if (isAppleTouchDevice() || !navigator.clipboard || !window.isSecureContext) {
                if (copyTextWithExecCommand(text)) {
                    succeed();
                    return true;
                }
                if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    navigator.clipboard.writeText(text).then(succeed).catch(fail);
                    return true;
                }
                fail(new Error('Copy is not available in this browser.'));
                return false;
            }
            navigator.clipboard.writeText(text).then(succeed).catch((err) => {
                if (copyTextWithExecCommand(text)) {
                    succeed();
                    return;
                }
                fail(err);
            });
            return true;
        };

        const copyPrivateKey = (event) => {
            if (!originalSeedInput.value) {
                showAlert('No seed phrase or private key to copy', 'warning');
                return;
            }
            copyText(originalSeedInput.value, event, 'Failed to copy to clipboard');
        };

        const getTxExplorerUrl = (signature) => buildTxExplorerUrl(signature, selectedNetwork.value);

        const rememberPreviousSession = (secret, address) => {
            if (!secret || !address) {
                return;
            }
            const existingIndex = previousSessions.value.findIndex((session) => session.secret === secret);
            const sessionType = pendingWalletSource || walletSource.value || (secret.includes(' ') ? 'mnemonic' : 'privateKey');
            if (existingIndex !== -1) {
                previousSessions.value[existingIndex] = {
                    ...previousSessions.value[existingIndex],
                    address,
                    type: sessionType,
                };
            } else {
                previousSessions.value.push({
                    id: `${Date.now()}-${address}`,
                    secret,
                    address,
                    type: sessionType,
                });
            }
            selectedPreviousSession.value = '';
        };

        const clearSession = () => {
            walletRecords.length = 0;
            accounts.value = [];
            isWalletInitialized.value = false;
            selectedFromAddress.value = '';
            tokenInfo.value = null;
            txStatus.value = '';
            txStatusType.value = '';
            txExplorerUrl.value = '';
            if (txStatusTimeout) {
                clearTimeout(txStatusTimeout);
                txStatusTimeout = null;
            }
            estimatedFee.value = '';
            error.value = '';
            seedPhrase.value = '';
            originalSeedInput.value = '';
            isPrivateKeyVisible.value = false;
            selectedPreviousSession.value = '';
            walletSource.value = '';
            pendingWalletSource = '';
            teardownFaucetTurnstile();
            faucetStatus.value = '';
            faucetStatusOk.value = false;
            faucetExplorerUrl.value = '';
            updateWalletStateUI();
            showAlert('Wallet session cleared.', 'info');
        };

        const resetSendState = () => {
            selectedFromAddress.value = '';
            tokenInfo.value = null;
            txStatus.value = '';
            txStatusType.value = '';
            txExplorerUrl.value = '';
            if (txStatusTimeout) {
                clearTimeout(txStatusTimeout);
                txStatusTimeout = null;
            }
            estimatedFee.value = '';
            error.value = '';
        };

        const initializeWallet = async () => {
            try {
                if (!rpcEndpoint.value || !seedPhrase.value) {
                    throw new Error('Please provide both an RPC endpoint and a seed phrase or private key');
                }
                isLoading.value = true;
                const opened = accountsFromSecret(seedPhrase.value);
                walletRecords.length = 0;
                opened.forEach((account) => walletRecords.push(account));
                accounts.value = [];
                isWalletInitialized.value = false;
                resetSendState();
                originalSeedInput.value = seedPhrase.value.trim().includes(' ')
                    ? seedPhrase.value.trim().split(/\s+/).join(' ')
                    : seedPhrase.value.trim();
                walletSource.value = pendingWalletSource || (originalSeedInput.value.includes(' ') ? 'mnemonic' : 'privateKey');
                applyChainInfo();
                await refreshAccounts();
                isWalletInitialized.value = true;
                updateWalletStateUI();
                rememberPreviousSession(originalSeedInput.value, walletRecords[0]?.address || accounts.value[0]?.address);
                pendingWalletSource = '';
                showAlert('Wallet initialized successfully!', 'success');
                refreshNetworkStatus();
            } catch (err) {
                pendingWalletSource = '';
                showError('Failed to initialize wallet: ' + err.message);
                showAlert('Failed to initialize wallet: ' + err.message, 'danger');
            } finally {
                isLoading.value = false;
            }
        };

        const refreshAccounts = async () => {
            const pricePromise = refreshNativeUsdPrices();
            const nextAccounts = [];
            for (let i = 0; i < walletRecords.length; i++) {
                const wallet = walletRecords[i];
                let balance = '0';
                try {
                    const result = await getBalance(rpcEndpoint.value, wallet.address);
                    balance = lamportsToSol(result?.value ?? 0);
                } catch (err) {
                    console.error(`Failed to get balance for ${wallet.address}:`, err);
                }
                nextAccounts.push({
                    address: wallet.address,
                    balance,
                    index: i,
                });
            }
            accounts.value = nextAccounts;
            await pricePromise;
            if (nextAccounts.length > 0 && !selectedFromAddress.value) {
                selectedFromAddress.value = nextAccounts[0].address;
            }
        };

        const isRefreshingBalances = ref(false);

        const refreshBalances = async () => {
            if (walletRecords.length === 0 || isRefreshingBalances.value) {
                return;
            }
            isRefreshingBalances.value = true;
            try {
                await refreshAccounts();
                if (tokenType.value === 'spl' && tokenAddress.value) {
                    await updateTokenBalance();
                }
            } catch (err) {
                showError('Failed to refresh balances: ' + err.message);
                showAlert('Failed to refresh balances: ' + err.message, 'danger');
            } finally {
                isRefreshingBalances.value = false;
            }
        };

        const loadSplInfo = async (owner, mintAddress) => {
            decodePublicKey(mintAddress);
            const tokenAccounts = await getTokenAccountsByOwner(rpcEndpoint.value, owner, mintAddress.trim());
            const parsed = tokenAccounts?.value?.[0]?.account?.data?.parsed?.info?.tokenAmount;
            if (parsed) {
                return {
                    mint: mintAddress.trim(),
                    balance: parsed.uiAmountString ?? '0',
                    decimals: Number(parsed.decimals),
                    symbol: formatAddressShort(mintAddress.trim()),
                    raw: parsed.amount ?? '0',
                };
            }
            const mintInfo = await getAccountInfo(
                rpcEndpoint.value,
                mintAddress.trim(),
                { encoding: 'jsonParsed', commitment: 'confirmed' },
            );
            const decimals = mintInfo?.value?.data?.parsed?.info?.decimals;
            if (decimals == null) {
                throw new Error('Mint account not found');
            }
            return {
                mint: mintAddress.trim(),
                balance: '0',
                decimals: Number(decimals),
                symbol: formatAddressShort(mintAddress.trim()),
                raw: '0',
            };
        };

        const updateTokenBalance = async () => {
            if (!selectedFromAddress.value || tokenType.value === 'native' || !tokenAddress.value) {
                tokenInfo.value = null;
                return;
            }
            try {
                tokenInfo.value = await loadSplInfo(selectedFromAddress.value, tokenAddress.value);
            } catch (err) {
                console.error('Failed to get token info:', err);
                tokenInfo.value = null;
            }
        };

        const accountExists = async (address) => {
            const result = await getAccountInfo(rpcEndpoint.value, address, { encoding: 'base64' });
            return Boolean(result?.value);
        };

        let estimateSeq = 0;

        const buildCurrentTransfer = async () => {
            const record = walletRecords.find((wallet) => wallet.address === selectedFromAddress.value);
            if (!record) {
                throw new Error('Selected address not found in wallets');
            }
            decodePublicKey(toAddress.value);
            const blockhashResult = await getLatestBlockhash(rpcEndpoint.value);
            const blockhash = blockhashResult?.value?.blockhash;
            if (!blockhash) {
                throw new Error('Failed to fetch a recent blockhash');
            }
            if (tokenType.value === 'native') {
                return buildAndSignSolTransfer({
                    seed: record.seed,
                    to: toAddress.value.trim(),
                    lamports: solToLamports(amount.value),
                    blockhash,
                });
            }
            if (!tokenAddress.value) {
                throw new Error('Please provide a token mint address');
            }
            const mint = tokenAddress.value.trim();
            const info = tokenInfo.value?.mint === mint
                ? tokenInfo.value
                : await loadSplInfo(record.address, mint);
            const destAta = encodePublicKey(associatedTokenAddress(
                decodePublicKey(toAddress.value),
                decodePublicKey(mint),
            ));
            const createDestinationAta = !(await accountExists(destAta));
            return {
                ...(await buildAndSignSplTransfer({
                    seed: record.seed,
                    mint,
                    toOwner: toAddress.value.trim(),
                    rawAmount: uiToRaw(amount.value, info.decimals),
                    decimals: info.decimals,
                    blockhash,
                    createDestinationAta,
                })),
                spl: info,
            };
        };

        const estimateFee = async () => {
            const seq = ++estimateSeq;
            if (!selectedFromAddress.value || !toAddress.value || !amount.value || !isWalletInitialized.value) {
                estimatedFee.value = '';
                return;
            }
            try {
                const built = await buildCurrentTransfer();
                const feeResult = await getFeeForMessage(rpcEndpoint.value, bytesToBase64(built.message));
                if (seq !== estimateSeq) {
                    return;
                }
                if (feeResult?.value == null) {
                    estimatedFee.value = '';
                    return;
                }
                estimatedFee.value = {
                    solCost: lamportsToSol(feeResult.value),
                    lamports: String(feeResult.value),
                };
            } catch (err) {
                console.error('Fee estimation failed:', err);
                if (seq === estimateSeq) {
                    estimatedFee.value = '';
                }
            }
        };

        const senderBalanceLamports = () => {
            const account = accounts.value.find((item) => item.address === selectedFromAddress.value);
            return solToLamports(account?.balance || '0');
        };

        const sendTransaction = async () => {
            try {
                if (txStatusTimeout) {
                    clearTimeout(txStatusTimeout);
                    txStatusTimeout = null;
                }
                if (!selectedFromAddress.value || !toAddress.value || !amount.value) {
                    throw new Error('Please fill in all required fields');
                }
                isLoading.value = true;
                txStatus.value = 'Preparing transaction...';
                txStatusType.value = 'success';
                txExplorerUrl.value = '';

                const built = await buildCurrentTransfer();
                const feeResult = await getFeeForMessage(rpcEndpoint.value, bytesToBase64(built.message));
                if (feeResult?.value == null) {
                    throw new Error('Failed to estimate the network fee');
                }
                const fee = BigInt(feeResult.value);
                const rent = BigInt(await getMinimumBalanceForRentExemption(rpcEndpoint.value, 0));
                const balance = senderBalanceLamports();
                if (tokenType.value === 'native') {
                    assertSolTransferAffordable({
                        balance,
                        lamports: solToLamports(amount.value),
                        fee,
                        rentExemptMinimum: rent,
                    });
                } else {
                    const info = built.spl;
                    const raw = uiToRaw(amount.value, info.decimals);
                    if (raw <= 0n) {
                        throw new Error('Amount must be greater than zero');
                    }
                    if (raw > BigInt(info.raw || '0')) {
                        throw new Error('Insufficient token balance');
                    }
                    assertFeeLeavesRent({ balance, fee, rentExemptMinimum: rent });
                }

                txStatus.value = 'Simulating transaction...';
                const simulation = await simulateTransaction(rpcEndpoint.value, bytesToBase64(built.wire));
                if (simulation?.value?.err) {
                    const logs = Array.isArray(simulation.value.logs) ? simulation.value.logs.slice(-2).join(' ') : '';
                    throw new Error(logs ? `Simulation failed: ${logs}` : 'Simulation failed');
                }

                txStatus.value = 'Sending transaction...';
                const signature = await rpcSendTransaction(rpcEndpoint.value, bytesToBase64(built.wire));
                const shown = signature || signatureBase58(built.wire);
                txExplorerUrl.value = getTxExplorerUrl(shown);
                txStatus.value = `Transaction sent! Signature: ${shown}`;
                txStatusType.value = 'success';
                await confirmSignature(rpcEndpoint.value, shown);
                txStatus.value += ' (Confirmed)';
                await refreshAccounts();
                if (tokenType.value === 'spl') {
                    await updateTokenBalance();
                }
            } catch (err) {
                txStatus.value = 'Transaction failed: ' + err.message;
                txStatusType.value = 'error';
                txExplorerUrl.value = '';
                txStatusTimeout = setTimeout(() => {
                    txStatus.value = '';
                    txStatusType.value = '';
                    txExplorerUrl.value = '';
                    txStatusTimeout = null;
                }, 10000);
            } finally {
                isLoading.value = false;
            }
        };

        const generatePrivateKeyWallet = async () => {
            try {
                pendingWalletSource = 'privateKey';
                seedPhrase.value = generatePrivateKeySecret();
                await initializeWallet();
            } catch (err) {
                pendingWalletSource = '';
                showError('Failed to generate wallet: ' + err.message);
                showAlert('Failed to generate wallet: ' + err.message, 'danger');
            }
        };

        const generateSeedPhraseWallet = async () => {
            try {
                pendingWalletSource = 'mnemonic';
                seedPhrase.value = generateMnemonicPhrase();
                await initializeWallet();
            } catch (err) {
                pendingWalletSource = '';
                showError('Failed to generate wallet: ' + err.message);
                showAlert('Failed to generate wallet: ' + err.message, 'danger');
            }
        };

        const applyPasskeyWallet = async (passkeyResult) => {
            pendingWalletSource = 'passkey';
            seedPhrase.value = formatSecretKey(passkeyResult.seed);
            await initializeWallet();
        };

        const generatePasskeyWallet = async () => {
            try {
                const result = await createPasskeyWallet();
                await applyPasskeyWallet(result);
            } catch (err) {
                pendingWalletSource = '';
                const message = passkeyErrorMessage(err);
                if (isPasskeyCancellation(err)) {
                    error.value = '';
                    showAlert(message, 'info');
                    return;
                }
                showError('Failed to create passkey wallet: ' + message);
                showAlert('Failed to create passkey wallet: ' + message, 'danger');
            }
        };

        const openPasskeyWallet = async () => {
            try {
                const result = await unlockPasskeyWallet();
                await applyPasskeyWallet(result);
            } catch (err) {
                pendingWalletSource = '';
                const message = passkeyErrorMessage(err);
                if (isPasskeyCancellation(err)) {
                    error.value = '';
                    showAlert(message, 'info');
                    return;
                }
                showError('Failed to open passkey wallet: ' + message);
                showAlert('Failed to open passkey wallet: ' + message, 'danger');
            }
        };

        const previousSessionLabel = (session) => {
            if (session?.type === 'passkey' && session.address) {
                return `Passkey ${formatAddressShort(session.address)}`;
            }
            return formatSecretShort(session?.secret);
        };

        const reconnectPreviousSession = async () => {
            const session = previousSessions.value.find((entry) => entry.id === selectedPreviousSession.value);
            if (!session) {
                return;
            }
            pendingWalletSource = session.type || '';
            seedPhrase.value = session.secret;
            await initializeWallet();
            selectedPreviousSession.value = '';
        };

        const copyAddress = (address, event) => {
            copyText(address, event, 'Failed to copy address to clipboard');
        };

        const generateQRCode = (address, elementRef) => {
            if (!elementRef || !address) return;
            elementRef.innerHTML = '';
            try {
                if (typeof QRCode === 'undefined' || typeof QRCode.toString !== 'function') {
                    elementRef.textContent = 'Error: QR Code library not loaded.';
                    return;
                }
                QRCode.toString(address, {
                    type: 'svg',
                    width: 256,
                    margin: 1,
                    errorCorrectionLevel: 'H',
                    color: { dark: '#000000', light: '#ffffff' },
                }, (err, svg) => {
                    if (err) {
                        elementRef.textContent = 'Error generating QR code.';
                        return;
                    }
                    elementRef.innerHTML = svg;
                });
            } catch {
                elementRef.textContent = 'Error generating QR code.';
            }
        };

        const generateAllQRCodes = () => {
            nextTick(() => {
                accounts.value.forEach((account) => {
                    const qrElement = document.querySelector(`[data-qr-address="${account.address}"]`);
                    if (qrElement) {
                        generateQRCode(account.address, qrElement);
                    }
                });
            });
        };

        const teardownFaucetTurnstile = () => {
            if (faucetTurnstileWidgetId.value != null && window.turnstile) {
                try {
                    window.turnstile.remove(faucetTurnstileWidgetId.value);
                } catch {
                    // ignore
                }
            }
            faucetTurnstileWidgetId.value = null;
            faucetTurnstileToken.value = '';
            if (faucetTurnstileEl.value) {
                faucetTurnstileEl.value.innerHTML = '';
            }
        };

        const mountFaucetTurnstile = async () => {
            await nextTick();
            if (!faucetAvailable.value || !faucetTurnstileEl.value) {
                return;
            }
            if (!window.turnstile) {
                setTimeout(mountFaucetTurnstile, 300);
                return;
            }
            if (isFaucetTurnstileAlreadyMounted(
                faucetTurnstileWidgetId.value,
                faucetTurnstileEl.value,
            )) {
                return;
            }
            teardownFaucetTurnstile();
            faucetTurnstileWidgetId.value = window.turnstile.render(faucetTurnstileEl.value, {
                sitekey: FAUCET_TURNSTILE_SITE_KEY,
                callback: (token) => {
                    faucetTurnstileToken.value = token;
                },
                'expired-callback': () => {
                    faucetTurnstileToken.value = '';
                },
                'error-callback': () => {
                    faucetTurnstileToken.value = '';
                },
                theme: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'light',
            });
        };

        const resetFaucetTurnstile = () => {
            faucetTurnstileToken.value = '';
            if (faucetTurnstileWidgetId.value != null && window.turnstile) {
                window.turnstile.reset(faucetTurnstileWidgetId.value);
            } else {
                mountFaucetTurnstile();
            }
        };

        const receiveFromFaucet = async (address) => {
            faucetStatus.value = '';
            faucetStatusOk.value = false;
            faucetExplorerUrl.value = '';
            if (!faucetAvailable.value) {
                showAlert('The faucet is only available on Devnet and Testnet.', 'warning');
                return;
            }
            if (!faucetTurnstileToken.value) {
                showAlert('Complete the captcha first.', 'warning');
                return;
            }
            faucetLoading.value = true;
            faucetBusyAddress.value = address;
            try {
                const result = await requestFaucetDrip({
                    address,
                    turnstileToken: faucetTurnstileToken.value,
                    chain: selectedNetwork.value,
                });
                faucetStatusOk.value = true;
                faucetStatus.value = `Sent ${result.amount} ${result.symbol}.`;
                faucetExplorerUrl.value = result.explorerTxUrl || buildTxExplorerUrl(result.txHash, selectedNetwork.value);
                showAlert(`Faucet sent ${result.amount} ${result.symbol} to this account.`, 'success');
                resetFaucetTurnstile();
                await refreshAccounts();
            } catch (err) {
                faucetStatusOk.value = false;
                const message = err?.message || 'Faucet request failed';
                faucetStatus.value = message;
                showAlert(message, 'danger');
                resetFaucetTurnstile();
            } finally {
                faucetLoading.value = false;
                faucetBusyAddress.value = '';
            }
        };

        const updateRpcEndpoint = async () => {
            const network = availableNetworks.value.find((item) => item.id === selectedNetwork.value);
            if (network && network.id !== 'custom') {
                rpcEndpoint.value = network.rpcUrl;
            }
            updateUrlWithNetwork(selectedNetwork.value);
            if (!faucetAvailable.value) {
                teardownFaucetTurnstile();
                faucetStatus.value = '';
                faucetStatusOk.value = false;
                faucetExplorerUrl.value = '';
            }
            await refreshNetworkStatus();
            if (isWalletInitialized.value && seedPhrase.value) {
                try {
                    await initializeWallet();
                } catch (err) {
                    showError('Failed to switch network: ' + err.message);
                    showAlert('Failed to switch network: ' + err.message, 'danger');
                }
            }
        };

        const onCustomRpcEdited = async () => {
            await refreshNetworkStatus();
            if (isWalletInitialized.value && seedPhrase.value) {
                await initializeWallet();
            }
        };

        onMounted(() => {
            document.documentElement.setAttribute('data-bs-theme', currentTheme.value);
            passkeysSupported.value = isPasskeySupported();
            updateWalletStateUI();

            const urlNetwork = getNetworkFromSearch(window.location.search);
            let validNetworkFromUrl = false;
            if (urlNetwork) {
                const network = availableNetworks.value.find((item) => item.id === urlNetwork && item.id !== 'custom');
                if (network) {
                    validNetworkFromUrl = true;
                    selectedNetwork.value = urlNetwork;
                    rpcEndpoint.value = network.rpcUrl;
                }
            }
            applyChainInfo();
            networkStatusText.value = `Selected Network: ${getNetworkName()}${validNetworkFromUrl ? '' : ' (Default)'}`;
            networkStatusClass.value = 'network-status text-primary';
            refreshNetworkStatus();

            watch(selectedNetwork, (networkId, previousId) => {
                if (previousId != null && networkId !== previousId) {
                    faucetStatus.value = '';
                    faucetStatusOk.value = false;
                    faucetExplorerUrl.value = '';
                }
                if (shouldMountFaucetTurnstileOnNetworkChange(
                    networkId,
                    document.getElementById('receive-tab-pane'),
                )) {
                    mountFaucetTurnstile();
                } else if (!isFaucetNetwork(networkId)) {
                    teardownFaucetTurnstile();
                }
            });

            const receiveTabTrigger = document.getElementById('receive-tab');
            if (receiveTabTrigger) {
                receiveTabTrigger.addEventListener('shown.bs.tab', () => {
                    if (isWalletInitialized.value) {
                        generateAllQRCodes();
                    }
                    if (faucetAvailable.value) {
                        mountFaucetTurnstile();
                    }
                });
            }
            const walletTabTrigger = document.getElementById('wallet-tab');
            if (walletTabTrigger) {
                walletTabTrigger.addEventListener('shown.bs.tab', () => {
                    if (isWalletInitialized.value) {
                        refreshBalances();
                    }
                });
            }
        });

        watch([selectedFromAddress, toAddress, amount, tokenType, tokenAddress], () => {
            if (isWalletInitialized.value && selectedFromAddress.value && toAddress.value && amount.value) {
                estimateFee();
            } else {
                estimatedFee.value = '';
            }
        });

        return {
            currentTheme,
            isLoading,
            alerts,
            showWalletManagement,
            sessionPanelOpen,
            networkStatusText,
            networkStatusClass,
            totalBalance,
            totalBalanceUsd,
            isPrivateKeyVisible,
            originalSeedInput,
            currentPrivateKeyDisplay,
            walletSource,
            passkeysSupported,
            selectedNetwork,
            availableNetworks,
            testnetNetworks,
            mainnetNetworks,
            rpcEndpoint,
            seedPhrase,
            seedVisible,
            previousSessions,
            selectedPreviousSession,
            error,
            accounts,
            selectedFromAddress,
            tokenType,
            tokenAddress,
            toAddress,
            amount,
            txStatus,
            txStatusType,
            txExplorerUrl,
            estimatedFee,
            chainInfo,
            tokenInfo,
            isWalletInitialized,
            faucetAvailable,
            faucetTurnstileEl,
            faucetTurnstileToken,
            faucetLoading,
            faucetBusyAddress,
            faucetStatus,
            faucetStatusOk,
            faucetExplorerUrl,
            toggleTheme,
            showAlert,
            dismissAlert,
            receiveFromFaucet,
            toggleSeedVisibility,
            toggleCurrentPrivateKeyVisibility,
            copyPrivateKey,
            clearSession,
            toggleSessionPanel,
            formatAccountBalance,
            formatAccountUsd,
            reconnectPreviousSession,
            initializeWallet,
            refreshBalances,
            isRefreshingBalances,
            updateTokenBalance,
            estimateFee,
            sendTransaction,
            generatePrivateKeyWallet,
            generateSeedPhraseWallet,
            generatePasskeyWallet,
            openPasskeyWallet,
            previousSessionLabel,
            copyAddress,
            updateRpcEndpoint,
            onCustomRpcEdited,
            refreshNetworkStatus,
            formatAddressShort,
        };
    }
}).mount('#app');
