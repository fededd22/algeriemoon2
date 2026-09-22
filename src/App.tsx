import React, { useState, useEffect, useRef } from "react";
import { 
  Shield, 
  Terminal, 
  Users, 
  Settings, 
  LogOut, 
  Activity, 
  Cpu, 
  HardDrive, 
  Clock, 
  RefreshCw, 
  Play, 
  Square, 
  Plus, 
  ToggleLeft, 
  ToggleRight, 
  Trash2, 
  Copy, 
  Check, 
  QrCode, 
  Search, 
  Key, 
  User, 
  AlertCircle,
  Database,
  Globe,
  Lock,
  ExternalLink,
  Sliders,
  Sparkles,
  ArrowRight,
  Zap
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import QRCode from "qrcode";

const V2RAY_PORT = 10080;

export default function App() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(localStorage.getItem("v2ray_dashboard_token"));
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // App state
  const [currentTab, setCurrentTab] = useState<"overview" | "clients" | "config" | "logs">("overview");
  const [serverStatus, setServerStatus] = useState<any>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [logsList, setLogsList] = useState<string[]>([]);
  const [isConfigLoading, setIsConfigLoading] = useState(false);
  const [configData, setConfigData] = useState<any>(null);
  
  // Client CRUD UI States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientId, setNewClientId] = useState("");
  const [newClientDuration, setNewClientDuration] = useState("30d");
  const [crudError, setCrudError] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientForQr, setSelectedClientForQr] = useState<any>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>("");
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [isSecureLink, setIsSecureLink] = useState(true); // Toggle between TLS (443) and Plain (3000)

  // Settings Edit State
  const [editWsPath, setEditWsPath] = useState("/by_moon");
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [settingsSuccess, setSettingsSuccess] = useState("");
  const [settingsError, setSettingsError] = useState("");

  // Terminal scroll reference
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);

  // Fetch helpers
  const getHeaders = () => ({
    "Content-Type": "application/json",
    "Authorization": `Bearer ${authToken}`
  });

  // Verify Auth on load
  useEffect(() => {
    if (!authToken) {
      setIsAuthenticated(false);
      return;
    }

    fetch("/api/auth-check", {
      headers: getHeaders()
    })
      .then(res => res.json())
      .then(data => {
        if (data.authenticated) {
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
          localStorage.removeItem("v2ray_dashboard_token");
        }
      })
      .catch(() => {
        setIsAuthenticated(false);
      });
  }, [authToken]);

  // Login Handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUsername || !loginPassword) {
      setLoginError("الرجاء إدخال اسم المستخدم وكلمة المرور / Please fill all fields");
      return;
    }

    setIsLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginUsername, password: loginPassword })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.setItem("v2ray_dashboard_token", data.token);
        setAuthToken(data.token);
        setIsAuthenticated(true);
      } else {
        setLoginError(data.error || "خطأ غير معروف / Login failed");
      }
    } catch (err: any) {
      setLoginError("فشل الاتصال بالخادم / Connection to server failed");
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Logout Handler
  const handleLogout = async () => {
    try {
      await fetch("/api/logout", {
        method: "POST",
        headers: getHeaders()
      });
    } catch (_) {}
    localStorage.removeItem("v2ray_dashboard_token");
    setAuthToken(null);
    setIsAuthenticated(false);
  };

  // Poll server status and logs
  useEffect(() => {
    if (!isAuthenticated) return;

    const fetchStatus = () => {
      fetch("/api/status", { headers: getHeaders() })
        .then(res => res.json())
        .then(data => {
          setServerStatus(data);
          if (data?.configPath) {
            setEditWsPath(data.configPath);
          }
        })
        .catch(err => console.error("Error fetching status:", err));
    };

    const fetchClients = () => {
      fetch("/api/clients", { headers: getHeaders() })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            setClients(data);
          }
        })
        .catch(err => console.error("Error fetching clients:", err));
    };

    const fetchLogs = () => {
      fetch("/api/logs", { headers: getHeaders() })
        .then(res => res.json())
        .then(data => {
          if (data && Array.isArray(data.logs)) {
            setLogsList(data.logs);
          }
        })
        .catch(err => console.error("Error fetching logs:", err));
    };

    fetchStatus();
    fetchClients();
    fetchLogs();

    const interval = setInterval(() => {
      fetchStatus();
      fetchClients();
      if (currentTab === "logs" || currentTab === "overview") {
        fetchLogs();
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [isAuthenticated, currentTab]);

  // Handle configuration Tab fetch
  useEffect(() => {
    if (!isAuthenticated || currentTab !== "config") return;

    setIsConfigLoading(true);
    fetch("/api/config", { headers: getHeaders() })
      .then(res => res.json())
      .then(data => {
        setConfigData(data);
        if (data.v2rayConfig?.inbounds?.[0]?.streamSettings?.wsSettings?.path) {
          setEditWsPath(data.v2rayConfig.inbounds[0].streamSettings.wsSettings.path);
        }
        if (data.credentials?.username) {
          setEditUsername(data.credentials.username);
        }
      })
      .catch(err => console.error("Error fetching full config:", err))
      .finally(() => setIsConfigLoading(false));
  }, [isAuthenticated, currentTab]);

  // Log Auto Scroll
  useEffect(() => {
    if (autoScrollLogs && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logsList, autoScrollLogs]);

  // V2Ray Control Action
  const handleControlAction = async (action: "start" | "stop" | "restart") => {
    try {
      const res = await fetch("/api/control", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (data.success) {
        // Quick state update
        setServerStatus((prev: any) => ({
          ...prev,
          running: action !== "stop",
          isStarting: action === "start" || action === "restart"
        }));
      }
    } catch (err) {
      console.error("Control action failed:", err);
    }
  };

  // Helper to generate UUID
  const triggerGenerateUUID = () => {
    const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    setNewClientId(uuid);
  };

  // Add client submit
  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientEmail || !newClientId || !newClientDuration) {
      setCrudError("الرجاء تعبئة كافة الحقول / All fields are required");
      return;
    }

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          email: newClientEmail,
          id: newClientId,
          duration: newClientDuration
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setClients(prev => [...prev, data.client]);
        setIsAddModalOpen(false);
        setNewClientEmail("");
        setNewClientId("");
        setNewClientDuration("30d");
        setCrudError("");
      } else {
        setCrudError(data.error || "فشل إضافة العميل / Failed to add client");
      }
    } catch (err: any) {
      setCrudError("فشل الاتصال بالخادم / Failed to communicate with server");
    }
  };

  // Toggle Client status
  const handleToggleClient = async (id: string) => {
    try {
      const res = await fetch(`/api/clients/${id}/toggle`, {
        method: "POST",
        headers: getHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setClients(prev => prev.map(c => {
          if (c.id === id) {
            return { ...c, isActive: !c.isActive };
          }
          return c;
        }));
      }
    } catch (err) {
      console.error("Toggle failed:", err);
    }
  };

  // Delete Client
  const handleDeleteClient = async (id: string) => {
    if (!confirm("هل أنت متأكد من حذف هذا العميل؟ / Are you sure you want to delete this client?")) return;

    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: "DELETE",
        headers: getHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setClients(prev => prev.filter(c => c.id !== id));
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  // Update server configs (websocket path and admin creds)
  const handleUpdateConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsSuccess("");
    setSettingsError("");

    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          path: editWsPath,
          username: editUsername,
          password: editPassword || undefined // Only update if filled
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSettingsSuccess("تم تحديث الإعدادات وإعادة تشغيل V2Ray بنجاح / Settings updated and V2Ray restarted successfully!");
        setEditPassword(""); // clear password field
      } else {
        setSettingsError(data.error || "فشل التحديث / Update failed");
      }
    } catch (err) {
      setSettingsError("فشل الاتصال بالخادم / Server connection failed");
    }
  };

  // QR Code and config generators
  const getVlessUri = (clientUuid: string, clientEmail: string, secure: boolean) => {
    const currentHost = window.location.host;
    let host = currentHost;
    let port = "443";

    if (currentHost.includes(":")) {
      const parts = currentHost.split(":");
      host = parts[0];
      port = secure ? "443" : parts[1];
    } else {
      port = secure ? "443" : "80";
    }

    const pathVal = serverStatus?.configPath || "/by_moon";
    const encodedEmail = encodeURIComponent(clientEmail);
    
    // Format VLESS URI
    // e.g. vless://uuid@host:port?path=/by_moon&security=tls&encryption=none&type=ws#email
    const security = secure ? "tls" : "none";
    return `vless://${clientUuid}@${host}:${port}?path=${encodeURIComponent(pathVal)}&security=${security}&encryption=none&type=ws#${encodedEmail}`;
  };

  const getClientJson = (clientUuid: string, clientEmail: string, secure: boolean) => {
    const currentHost = window.location.host;
    let host = currentHost;
    let port = "443";

    if (currentHost.includes(":")) {
      const parts = currentHost.split(":");
      host = parts[0];
      port = secure ? "443" : parts[1];
    } else {
      port = secure ? "443" : "80";
    }

    const pathVal = serverStatus?.configPath || "/by_moon";

    return JSON.stringify({
      v: "2",
      ps: `${clientEmail} (VLESS-WS)`,
      add: host,
      port: parseInt(port),
      id: clientUuid,
      aid: 0,
      scy: "none",
      net: "ws",
      type: "none",
      host: host,
      path: pathVal,
      tls: secure ? "tls" : "none",
      sni: host
    }, null, 2);
  };

  // Open QR modal and generate QR url
  const handleOpenQr = (client: any) => {
    setSelectedClientForQr(client);
    const uri = getVlessUri(client.id, client.email, isSecureLink);
    QRCode.toDataURL(uri, { 
      width: 280, 
      margin: 1.5,
      color: {
        dark: '#0f172a', // Slate-900
        light: '#f8fafc' // Slate-50
      }
    })
      .then(url => {
        setQrCodeDataUrl(url);
      })
      .catch(err => {
        console.error("QR Generation error:", err);
      });
  };

  // Re-generate QR if secure link toggle changes
  useEffect(() => {
    if (selectedClientForQr) {
      handleOpenQr(selectedClientForQr);
    }
  }, [isSecureLink]);

  // Copy helper
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => {
      setCopiedText(null);
    }, 2000);
  };

  // Format memory
  const formatMemory = (bytes: number) => {
    if (!bytes) return "0 MB";
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  // Duration Helper translations
  const translateDuration = (dur: string) => {
    if (dur === "unlimited") return "غير محدود / Unlimited";
    const num = dur.match(/\d+/)?.[0] || "";
    const unit = dur.match(/[a-zA-Z]+/)?.[0] || "";
    
    let arabicUnit = "";
    let englishUnit = "";
    if (unit === "m") { arabicUnit = "دقائق"; englishUnit = "minutes"; }
    else if (unit === "h") { arabicUnit = "ساعات"; englishUnit = "hours"; }
    else if (unit === "d") { arabicUnit = "أيام"; englishUnit = "days"; }
    else if (unit === "w") { arabicUnit = "أسابيع"; englishUnit = "weeks"; }

    return `${num} ${arabicUnit} / ${num} ${englishUnit}`;
  };

  // Time left formatter
  const getTimeLeft = (expiryTime: number | null) => {
    if (!expiryTime) return { text: "نشط دائمًا / Always Active", isExpired: false };
    const diff = expiryTime - Date.now();
    if (diff <= 0) return { text: "منتهي الصلاحية / Expired", isExpired: true };

    const minutes = Math.floor(diff / (1000 * 60)) % 60;
    const hours = Math.floor(diff / (1000 * 60 * 60)) % 24;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    let str = "";
    if (days > 0) str += `${days} يوم `;
    if (hours > 0) str += `${hours} ساعة `;
    if (days === 0 && minutes > 0) str += `${minutes} دقيقة`;
    
    return { text: `متبقي: ${str} / Left: ${days}d ${hours}h`, isExpired: false };
  };

  // Filtered clients
  const filteredClients = clients.filter(c => 
    c.email.toLowerCase().includes(clientSearch.toLowerCase()) ||
    c.id.toLowerCase().includes(clientSearch.toLowerCase())
  );

  // Still loading Auth session
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center font-sans text-slate-100">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
          <p className="text-sm font-mono tracking-widest text-slate-400">LOADING DATABASE...</p>
        </div>
      </div>
    );
  }

  // Not Authenticated screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 font-sans text-slate-100 relative overflow-hidden">
        {/* Aesthetic backgrounds */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-950/20 rounded-full blur-3xl -z-10" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-950/15  rounded-full blur-3xl -z-10" />

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl p-6 md:p-8 shadow-2xl backdrop-blur-md"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/10 mb-4">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-center bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              moon-vless_v2ray
            </h1>
            <p className="text-xs text-slate-400 font-mono mt-1">لوحة إدارة خادم VLESS الآمن والألعاب ذو بينج منخفض</p>
          </div>

          {loginError && (
            <div className="mb-6 p-4 bg-rose-950/40 border border-rose-800/60 rounded-xl flex items-start gap-3 text-rose-200 text-sm">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-slate-400 mb-2">
                اسم المستخدم / Username
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-950 text-slate-100 rounded-xl pl-11 pr-4 py-3 text-sm transition-all outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-slate-400 mb-2">
                كلمة المرور / Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-950 text-slate-100 rounded-xl pl-11 pr-4 py-3 text-sm transition-all outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 active:from-cyan-600 active:to-blue-700 disabled:from-slate-800 disabled:to-slate-800 text-slate-950 font-semibold py-3 px-4 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/10 cursor-pointer disabled:cursor-not-allowed text-white"
            >
              {isLoggingIn ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>جاري تسجيل الدخول... / Authenticating...</span>
                </>
              ) : (
                <>
                  <span>تسجيل الدخول / Login</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-800 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Sparkles className="w-3.5 h-3.5 text-cyan-500/50" />
            <span>Default credentials: admin / adminpassword</span>
          </div>
        </motion.div>
      </div>
    );
  }

  // Authenticated Dashboard Layout
  return (
    <div className="min-h-screen bg-slate-950 font-sans text-slate-100 flex flex-col">
      
      {/* Dynamic Header */}
      <header className="bg-slate-900/60 backdrop-blur-md border-b border-slate-800/80 sticky top-0 z-40 px-4 md:px-8 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          
          {/* Logo Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-cyan-950 border border-cyan-800/50 rounded-lg flex items-center justify-center text-cyan-400 shadow-md shadow-cyan-500/5">
              <Shield className="w-5.5 h-5.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white leading-tight">
                  moon-vless_v2ray
                </h1>
                <span className="bg-emerald-500/15 text-emerald-400 text-[10px] font-mono font-medium px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1">
                  Gaming Optimized ⚡
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">لوحة خادم VLESS آمن ذو بينج منخفض للألعاب</p>
            </div>
          </div>

          {/* Controls & Quick stats */}
          <div className="flex flex-wrap items-center gap-3.5">
            {/* V2Ray daemon indicator */}
            <div className="flex items-center gap-3 bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2 text-xs">
              <span className="text-slate-400 font-mono">DAEMON:</span>
              <div className="flex items-center gap-1.5 font-semibold font-mono">
                {serverStatus?.isStarting ? (
                  <>
                    <span className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-pulse" />
                    <span className="text-amber-400 uppercase">STARTING</span>
                  </>
                ) : serverStatus?.running ? (
                  <>
                    <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-emerald-400 uppercase">ONLINE</span>
                  </>
                ) : (
                  <>
                    <span className="w-2.5 h-2.5 bg-rose-500 rounded-full" />
                    <span className="text-rose-400 uppercase">OFFLINE</span>
                  </>
                )}
              </div>
            </div>

            {/* Daemon controls */}
            <div className="flex items-center gap-1.5 bg-slate-950/60 border border-slate-800/80 rounded-xl p-1">
              <button
                onClick={() => handleControlAction("start")}
                disabled={serverStatus?.running || serverStatus?.isStarting}
                title="Start Server"
                className="p-2 hover:bg-emerald-500/10 text-emerald-400 hover:text-emerald-300 disabled:opacity-30 rounded-lg transition-colors cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
              </button>
              <button
                onClick={() => handleControlAction("stop")}
                disabled={!serverStatus?.running}
                title="Stop Server"
                className="p-2 hover:bg-rose-500/10 text-rose-400 hover:text-rose-300 disabled:opacity-30 rounded-lg transition-colors cursor-pointer"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
              <button
                onClick={() => handleControlAction("restart")}
                title="Restart Server"
                className="p-2 hover:bg-cyan-500/10 text-cyan-400 hover:text-cyan-300 rounded-lg transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            {/* Logout button */}
            <button
              onClick={handleLogout}
              className="bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer shadow-sm"
            >
              <LogOut className="w-3.5 h-3.5 text-rose-400" />
              <span className="hidden sm:inline">خروج / Logout</span>
            </button>

          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 md:px-8 py-6 md:py-8 flex flex-col gap-6">
        
        {/* Navigation Tabs */}
        <div className="border-b border-slate-800 flex overflow-x-auto gap-2">
          <button
            onClick={() => setCurrentTab("overview")}
            className={`px-4 pb-3 text-sm font-semibold tracking-wide border-b-2 flex items-center gap-2 shrink-0 transition-all cursor-pointer ${
              currentTab === "overview" 
                ? "border-cyan-500 text-cyan-400" 
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>لوحة المراقبة / Overview</span>
          </button>

          <button
            onClick={() => setCurrentTab("clients")}
            className={`px-4 pb-3 text-sm font-semibold tracking-wide border-b-2 flex items-center gap-2 shrink-0 transition-all cursor-pointer ${
              currentTab === "clients" 
                ? "border-cyan-500 text-cyan-400" 
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Users className="w-4 h-4" />
            <span>إدارة المشتركين / Clients</span>
            {clients.length > 0 && (
              <span className="ml-1 bg-cyan-950 text-cyan-400 border border-cyan-800/40 text-[10px] px-2 py-0.5 rounded-full font-mono">
                {clients.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setCurrentTab("config")}
            className={`px-4 pb-3 text-sm font-semibold tracking-wide border-b-2 flex items-center gap-2 shrink-0 transition-all cursor-pointer ${
              currentTab === "config" 
                ? "border-cyan-500 text-cyan-400" 
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>إعدادات الخادم / Configuration</span>
          </button>

          <button
            onClick={() => setCurrentTab("logs")}
            className={`px-4 pb-3 text-sm font-semibold tracking-wide border-b-2 flex items-center gap-2 shrink-0 transition-all cursor-pointer ${
              currentTab === "logs" 
                ? "border-cyan-500 text-cyan-400" 
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>سجل النظام / System Logs</span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="flex-1">
          <AnimatePresence mode="wait">
            
            {/* OVERVIEW TAB */}
            {currentTab === "overview" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  
                  {/* Total active clients */}
                  <div className="bg-slate-900/45 border border-slate-800/80 rounded-2xl p-5 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-mono text-slate-400 uppercase tracking-wider">Active Users / المشتركين النشطين</p>
                      <h3 className="text-2xl font-bold tracking-tight text-white mt-1.5 font-mono">
                        {clients.filter(c => c.isActive && (!c.expiryTime || c.expiryTime > Date.now())).length}
                        <span className="text-xs font-normal text-slate-500 ml-1">/ {clients.length} total</span>
                      </h3>
                    </div>
                    <div className="w-11 h-11 bg-cyan-950/50 text-cyan-400 border border-cyan-800/20 rounded-xl flex items-center justify-center">
                      <Users className="w-5 h-5" />
                    </div>
                  </div>

                  {/* System Memory */}
                  <div className="bg-slate-900/45 border border-slate-800/80 rounded-2xl p-5 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-mono text-slate-400 uppercase tracking-wider">Node RSS RAM / الذاكرة المستخدمة</p>
                      <h3 className="text-2xl font-bold tracking-tight text-white mt-1.5 font-mono">
                        {serverStatus?.system?.memory ? formatMemory(serverStatus.system.memory.rss) : "N/A"}
                      </h3>
                    </div>
                    <div className="w-11 h-11 bg-purple-950/40 text-purple-400 border border-purple-800/20 rounded-xl flex items-center justify-center">
                      <Cpu className="w-5 h-5" />
                    </div>
                  </div>

                  {/* WS Connection Path */}
                  <div className="bg-slate-900/45 border border-slate-800/80 rounded-2xl p-5 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-mono text-slate-400 uppercase tracking-wider">WebSocket Path / مسار الاتصال</p>
                      <h3 className="text-lg font-bold font-mono tracking-tight text-cyan-400 mt-1.5 truncate max-w-[180px]">
                        {serverStatus?.configPath || "/by_moon"}
                      </h3>
                    </div>
                    <div className="w-11 h-11 bg-blue-950/40 text-blue-400 border border-blue-800/20 rounded-xl flex items-center justify-center">
                      <Globe className="w-5 h-5" />
                    </div>
                  </div>

                  {/* System Uptime */}
                  <div className="bg-slate-900/45 border border-slate-800/80 rounded-2xl p-5 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-mono text-slate-400 uppercase tracking-wider">Uptime / مدة تشغيل الخدمة</p>
                      <h3 className="text-lg font-bold font-mono tracking-tight text-white mt-1.5">
                        {serverStatus?.system?.uptime ? (
                          <>
                            {Math.floor(serverStatus.system.uptime / 3600)}h {Math.floor((serverStatus.system.uptime % 3600) / 60)}m {serverStatus.system.uptime % 60}s
                          </>
                        ) : "N/A"}
                      </h3>
                    </div>
                    <div className="w-11 h-11 bg-slate-850 text-slate-400 border border-slate-800 rounded-xl flex items-center justify-center">
                      <Clock className="w-5 h-5" />
                    </div>
                  </div>

                </div>

                {/* Main panel - Quick Logs & Server Info */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  
                  {/* Logs Preview console */}
                  <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4">
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                      <div className="flex items-center gap-2">
                        <Terminal className="w-5 h-5 text-cyan-400" />
                        <h3 className="text-sm font-semibold text-white">
                          مراقبة الأحداث المباشرة / Real-Time Server Activity
                        </h3>
                      </div>
                      <span className="text-[10px] font-mono text-cyan-500 bg-cyan-950 border border-cyan-800/30 px-2 py-0.5 rounded-full animate-pulse">
                        LIVE POLLING
                      </span>
                    </div>

                    <div className="bg-slate-950 border border-slate-850 rounded-xl p-4 font-mono text-[11px] leading-relaxed text-slate-300 h-[280px] overflow-y-auto terminal-scrollbar space-y-1">
                      {logsList.length === 0 ? (
                        <p className="text-slate-500 italic">لا توجد سجلات حالياً / Waiting for logs...</p>
                      ) : (
                        logsList.slice(-15).map((log, i) => (
                          <div 
                            key={i} 
                            className={`py-0.5 border-l-2 pl-2 truncate ${
                              log.includes("ERROR") || log.includes("Error") || log.includes("failed")
                                ? "border-rose-500 text-rose-300 bg-rose-950/10" 
                                : log.includes("success") || log.includes("ONLINE") || log.includes("Synced")
                                ? "border-emerald-500 text-emerald-300 bg-emerald-950/10"
                                : log.includes("V2Ray STDOUT")
                                ? "border-cyan-500/50 text-slate-300"
                                : "border-slate-800 text-slate-400"
                            }`}
                          >
                            {log}
                          </div>
                        ))
                      )}
                    </div>
                    <button
                      onClick={() => setCurrentTab("logs")}
                      className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 self-end flex items-center gap-1 cursor-pointer"
                    >
                      <span>عرض كامل السجل / View full logs</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* System properties card */}
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3 mb-4">
                        <Database className="w-5 h-5 text-cyan-400" />
                        <h3 className="text-sm font-semibold text-white">تفاصيل بيئة التشغيل / System Env</h3>
                      </div>

                      <div className="space-y-4 text-xs">
                        <div className="flex justify-between items-center py-1 border-b border-slate-800/30">
                          <span className="text-slate-400">Node Version</span>
                          <span className="font-mono text-slate-200">{serverStatus?.system?.nodeVersion || "N/A"}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-slate-800/30">
                          <span className="text-slate-400">OS Platform</span>
                          <span className="font-mono text-slate-200 capitalize">{serverStatus?.system?.platform || "linux"} ({serverStatus?.system?.arch || "x64"})</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-slate-800/30">
                          <span className="text-slate-400">V2Ray WS Port</span>
                          <span className="font-mono text-emerald-400 font-semibold">{V2RAY_PORT}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-slate-800/30">
                          <span className="text-slate-400">Proxy Mode</span>
                          <span className="font-mono text-slate-200">VLESS + WebSockets</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-slate-400">Database Engine</span>
                          <span className="font-mono text-cyan-400 flex items-center gap-1">
                            <span>JSON Server File</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-cyan-950/20 border border-cyan-850/30 rounded-xl p-3 mt-4 text-[11px] text-cyan-200/80 leading-relaxed">
                      <p className="font-semibold text-cyan-300 mb-1">💡 معلومات الاتصال / Connection Note:</p>
                      تأكد من فتح المنفذ الخارجي 443 لاستقبال اتصالات العملاء الآمنة عبر النفق السحابي HTTPS.
                    </div>
                  </div>

                </div>

                {/* Gaming optimization showcase */}
                <div className="bg-gradient-to-r from-slate-900 to-slate-950 border border-cyan-500/20 rounded-2xl p-6 shadow-lg shadow-cyan-950/10">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-4 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 bg-cyan-950/80 border border-cyan-500/30 text-cyan-400 rounded-xl flex items-center justify-center animate-pulse">
                        <Zap className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold text-white">سيرفر مهيأ للألعاب والاتصال السريع / Game Server Mode (Low Ping)</h3>
                          <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] px-2 py-0.5 rounded-full font-mono font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                            ACTIVE
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">تعديلات خاصة في النواة ونظام التوجيه لضمان أقل بينج واستجابة فائقة السرعة للألعاب الأونلاين.</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs mt-4">
                    <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-4">
                      <h4 className="font-semibold text-cyan-400 mb-2 flex items-center gap-2">
                        <span className="text-cyan-500 font-mono">⚡</span>
                        منفذ استجابة سريع / TCP Fast Open (TFO)
                      </h4>
                      <p className="text-slate-400 leading-relaxed text-[11px]">
                        تفعيل خيار TCP Fast Open لتقليص زمن المصافحة وتجاوز المراحل الثلاث لإنشاء الاتصال، مما يسرع التحميل بشكل ملحوظ في الألعاب المتزامنة.
                      </p>
                    </div>

                    <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-4">
                      <h4 className="font-semibold text-cyan-400 mb-2 flex items-center gap-2">
                        <span className="text-cyan-500 font-mono">📡</span>
                        توجيه مباشر وبينج منخفض / Low Latency DNS
                      </h4>
                      <p className="text-slate-400 leading-relaxed text-[11px]">
                        دمج مخدمات DNS مخصصة للألعاب (Cloudflare 1.1.1.1 & Google 8.8.8.8) لضمان تسريع دقة العناوين وتقليل الـ Packet Loss أثناء اللعب الجماعي.
                      </p>
                    </div>

                    <div className="bg-slate-900/50 border border-slate-800/40 rounded-xl p-4">
                      <h4 className="font-semibold text-cyan-400 mb-2 flex items-center gap-2">
                        <span className="text-cyan-500 font-mono">🎮</span>
                        دعم بروتوكول UDP الكامل / Full UDP Tunneling
                      </h4>
                      <p className="text-slate-400 leading-relaxed text-[11px]">
                        تمرير حزم UDP المباشرة بأعلى أولوية لتسهيل جلب السيرفرات والتوافق التام مع ألعاب مثل PUBG, Free Fire, Valorant والمكالمات الصوتية كـ Discord.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 bg-cyan-950/15 border border-cyan-850/20 rounded-xl p-4 text-[11px] text-cyan-200/80 leading-relaxed flex items-start gap-3">
                    <span className="text-base">💡</span>
                    <div>
                      <p className="font-semibold text-cyan-300 mb-1">نصائح للحصول على أفضل تجربة بينغ ألعاب / Gaming Tuning Tips:</p>
                      للحصول على أفضل استقرار وبينج منخفض، يرجى تعطيل خيار <strong>Mux (Multiplexing)</strong> في إعدادات التطبيق العميل الخاص بك (مثل Nekobox أو v2rayN أو Shadowrocket)، والتأكد من تفعيل خيار <strong>Enable UDP / تفعيل UDP</strong> للسماح بحزم الألعاب بالمرور مباشرة دون تحجيم.
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* CLIENTS TAB */}
            {currentTab === "clients" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                {/* Search & Action Panel */}
                <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      placeholder="ابحث عن بريد العميل أو معرف UUID... / Search email, UUID..."
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-950 text-slate-100 rounded-xl pl-11 pr-4 py-2.5 text-xs transition-all outline-none"
                    />
                  </div>

                  <button
                    onClick={() => {
                      setCrudError("");
                      setIsAddModalOpen(true);
                      triggerGenerateUUID();
                    }}
                    className="bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-600 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <Plus className="w-4 h-4 text-slate-950" />
                    <span>إضافة عميل جديد / Create Client</span>
                  </button>
                </div>

                {/* Clients Grid */}
                {filteredClients.length === 0 ? (
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400">
                    <Users className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                    <p className="text-sm font-semibold">لم يتم العثور على عملاء تطابق بحثك / No clients found</p>
                    <p className="text-xs text-slate-500 mt-1">ابدأ بإنشاء أول حساب عميل لإضافته إلى خادم V2Ray.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredClients.map((client) => {
                      const expiryInfo = getTimeLeft(client.expiryTime);
                      const isExpired = expiryInfo.isExpired;

                      return (
                        <div 
                          key={client.id}
                          className={`bg-slate-900 border rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all ${
                            !client.isActive 
                              ? "border-slate-850 opacity-60" 
                              : isExpired 
                              ? "border-rose-900/50 hover:border-rose-950" 
                              : "border-slate-800 hover:border-slate-700/80"
                          }`}
                        >
                          {/* Client Header details */}
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <h4 className="font-bold text-slate-100 truncate max-w-[220px]">
                                  {client.email}
                                </h4>
                                <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate max-w-[200px]" title={client.id}>
                                  UUID: {client.id}
                                </p>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {/* Expiry badge */}
                                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                                  !client.isActive 
                                    ? "bg-slate-950 text-slate-500 border-slate-800" 
                                    : isExpired 
                                    ? "bg-rose-500/10 text-rose-400 border-rose-500/20" 
                                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                }`}>
                                  {!client.isActive ? "SUSPENDED" : isExpired ? "EXPIRED" : "ACTIVE"}
                                </span>

                                {/* Active Toggle */}
                                <button
                                  onClick={() => handleToggleClient(client.id)}
                                  title={client.isActive ? "تعطيل المشترك / Suspend Client" : "تفعيل المشترك / Activate Client"}
                                  className="text-slate-400 hover:text-white transition-colors cursor-pointer"
                                >
                                  {client.isActive ? (
                                    <ToggleRight className="w-8 h-8 text-cyan-400" />
                                  ) : (
                                    <ToggleLeft className="w-8 h-8 text-slate-600" />
                                  )}
                                </button>
                              </div>
                            </div>

                            {/* Info list */}
                            <div className="mt-4 pt-3 border-t border-slate-850/80 space-y-2 text-xs">
                              <div className="flex justify-between items-center text-[11px]">
                                <span className="text-slate-500">مدة الاشتراك / Duration</span>
                                <span className="text-slate-300 font-medium">{translateDuration(client.duration)}</span>
                              </div>
                              <div className="flex justify-between items-center text-[11px]">
                                <span className="text-slate-500">تاريخ الإنشاء / Created At</span>
                                <span className="text-slate-300 font-mono">{new Date(client.createdAt).toLocaleDateString()}</span>
                              </div>
                              <div className="flex justify-between items-center text-[11px]">
                                <span className="text-slate-500">الصلاحية / Expiry</span>
                                <span className={`font-semibold font-mono ${isExpired && client.isActive ? "text-rose-400" : "text-cyan-400"}`}>
                                  {expiryInfo.text}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Action Toolbar */}
                          <div className="pt-3 border-t border-slate-850/80 flex items-center justify-between gap-2 mt-auto">
                            {/* QR & copy configuration */}
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleOpenQr(client)}
                                disabled={isExpired || !client.isActive}
                                className="bg-slate-950 border border-slate-800 hover:bg-slate-850 hover:border-slate-700 disabled:opacity-30 disabled:hover:bg-slate-950 text-cyan-400 disabled:text-slate-500 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                              >
                                <QrCode className="w-3.5 h-3.5" />
                                <span>QR Code & Links</span>
                              </button>

                              <button
                                onClick={() => copyToClipboard(getVlessUri(client.id, client.email, true), client.id)}
                                disabled={isExpired || !client.isActive}
                                className="p-2 bg-slate-950 border border-slate-800 hover:bg-slate-850 disabled:opacity-30 text-slate-300 rounded-lg transition-all cursor-pointer"
                                title="نسخ رابط VLESS الآمن / Copy secure VLESS URI"
                              >
                                {copiedText === client.id ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>

                            {/* Delete client */}
                            <button
                              onClick={() => handleDeleteClient(client.id)}
                              className="p-2 hover:bg-rose-950/40 text-rose-400 hover:text-rose-300 rounded-lg transition-colors cursor-pointer"
                              title="حذف الحساب / Delete Client"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}

            {/* CONFIGURATION TAB */}
            {currentTab === "config" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="max-w-3xl mx-auto space-y-6"
              >
                {isConfigLoading ? (
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center flex flex-col items-center justify-center gap-3 text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
                    <p className="text-xs font-mono">LOADING CONFIGURATION DATA...</p>
                  </div>
                ) : (
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 md:p-8 space-y-6">
                    <div className="border-b border-slate-800 pb-4">
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <Sliders className="w-5 h-5 text-cyan-400" />
                        <span>تعديل إعدادات خادم VLESS / Server Settings Editor</span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">تغيير مسار الاتصالات لـ V2Ray أو تعديل بيانات لوحة التحكم.</p>
                    </div>

                    {settingsSuccess && (
                      <div className="p-4 bg-emerald-950/40 border border-emerald-800/60 rounded-xl text-emerald-200 text-xs font-medium">
                        {settingsSuccess}
                      </div>
                    )}

                    {settingsError && (
                      <div className="p-4 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-200 text-xs font-medium">
                        {settingsError}
                      </div>
                    )}

                    <form onSubmit={handleUpdateConfig} className="space-y-6">
                      
                      {/* V2Ray WS Path settings */}
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                          مسار WebSocket لـ V2Ray / V2Ray WS Connection Path
                        </label>
                        <input
                          type="text"
                          value={editWsPath}
                          onChange={(e) => setEditWsPath(e.target.value)}
                          placeholder="/by_moon"
                          className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-950 text-slate-100 rounded-xl px-4 py-3 text-sm font-mono transition-all outline-none"
                        />
                        <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                          ⚠️ يجب أن يبدأ المسار بـ (/). عند التحديث، سيقوم خادم النفق السحابي بإعادة تشغيل V2Ray تلقائياً لتطبيق المسار الجديد.
                        </p>
                      </div>

                      {/* Credentials settings */}
                      <div className="border-t border-slate-800/60 pt-6 space-y-4">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                          بيانات المدير للوحة التحكم / Admin Dashboard Credentials
                        </h4>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-2">اسم مستخدم الإدارة / Admin Username</label>
                            <input
                              type="text"
                              value={editUsername}
                              onChange={(e) => setEditUsername(e.target.value)}
                              placeholder="admin"
                              className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 text-slate-100 rounded-xl px-4 py-2.5 text-xs transition-all outline-none"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] text-slate-400 mb-2">كلمة المرور الجديدة / New Password (أتركه فارغاً لعدم التغيير)</label>
                            <input
                              type="password"
                              value={editPassword}
                              onChange={(e) => setEditPassword(e.target.value)}
                              placeholder="••••••••"
                              className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 text-slate-100 rounded-xl px-4 py-2.5 text-xs transition-all outline-none"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Save buttons */}
                      <div className="pt-4 border-t border-slate-800 flex justify-end">
                        <button
                          type="submit"
                          className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 active:from-cyan-600 active:to-blue-700 text-slate-950 font-bold px-6 py-2.5 rounded-xl text-xs transition-all shadow-lg shadow-cyan-500/10 cursor-pointer text-white"
                        >
                          حفظ وتطبيق الإعدادات / Save & Apply Config
                        </button>
                      </div>

                    </form>
                  </div>
                )}
              </motion.div>
            )}

            {/* SYSTEM LOGS TAB */}
            {currentTab === "logs" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-4 flex flex-col h-full"
              >
                {/* Console header actions */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-cyan-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
                      v2ray-daemon STDOUT & STDERR logs
                    </h3>
                  </div>

                  <div className="flex items-center gap-2.5">
                    {/* Autoscroll checkbox toggle */}
                    <label className="inline-flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={autoScrollLogs} 
                        onChange={(e) => setAutoScrollLogs(e.target.checked)}
                        className="rounded bg-slate-900 border-slate-800 text-cyan-500 focus:ring-0" 
                      />
                      <span>التمرير التلقائي / Auto-scroll</span>
                    </label>

                    {/* Clear logs list view */}
                    <button
                      onClick={() => setLogsList([])}
                      className="bg-slate-900 border border-slate-800 hover:bg-slate-850 text-slate-400 px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer"
                    >
                      مسح شاشة العرض / Clear View
                    </button>
                  </div>
                </div>

                {/* Console view */}
                <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-5 flex-1 flex flex-col gap-3 min-h-[450px]">
                  <div className="bg-slate-950 border border-slate-850 rounded-xl p-4 font-mono text-[11px] leading-relaxed text-slate-300 h-[400px] overflow-y-auto terminal-scrollbar flex-1 space-y-1 bg-slate-950/85">
                    {logsList.length === 0 ? (
                      <p className="text-slate-500 italic">لا توجد سجلات حالياً / Waiting for new daemon events...</p>
                    ) : (
                      logsList.map((log, i) => (
                        <div 
                          key={i} 
                          className={`py-0.5 border-l-2 pl-3 select-all whitespace-pre-wrap ${
                            log.includes("ERROR") || log.includes("Error") || log.includes("failed")
                              ? "border-rose-500 text-rose-300 bg-rose-950/10" 
                              : log.includes("success") || log.includes("ONLINE") || log.includes("Synced")
                              ? "border-emerald-500 text-emerald-300 bg-emerald-950/10"
                              : log.includes("V2Ray STDOUT")
                              ? "border-cyan-500/50 text-slate-300"
                              : "border-slate-850 text-slate-500"
                          }`}
                        >
                          {log}
                        </div>
                      ))
                    )}
                    <div ref={terminalEndRef} />
                  </div>
                  
                  <p className="text-[10px] text-slate-500 font-mono text-center">
                    Dashboard system log buffer captures the last 500 runtime daemon stdout / stderr entries.
                  </p>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-900 bg-slate-950/40 py-5 text-center text-xs text-slate-500 px-4">
        <p>© 2026 V2Ray VLESS WebSocket Server Dashboard. All rights reserved.</p>
        <p className="font-mono text-[10px] text-slate-600 mt-1">Status: Running | Database Engine: Local JSON | UI Framework: React 19 + Tailwind</p>
      </footer>

      {/* MODAL: ADD CLIENT */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl p-6 relative"
          >
            <div className="border-b border-slate-800 pb-4 mb-5 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-cyan-400" />
                <span>إضافة حساب مشترك جديد / Create Client Connection</span>
              </h3>
            </div>

            {crudError && (
              <div className="mb-4 p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-200 text-xs">
                {crudError}
              </div>
            )}

            <form onSubmit={handleAddClient} className="space-y-4">
              {/* Client Email */}
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-2">
                  البريد الإلكتروني للعميل / Client Email Identifier
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. user@example.com"
                  value={newClientEmail}
                  onChange={(e) => setNewClientEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-950 text-slate-100 rounded-xl px-4 py-2.5 text-xs transition-all outline-none"
                />
              </div>

              {/* Client UUID */}
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-2 flex justify-between items-center">
                  <span>معرّف UUID العميل / Client UUID</span>
                  <button
                    type="button"
                    onClick={triggerGenerateUUID}
                    className="text-[10px] font-semibold text-cyan-400 hover:text-cyan-300 cursor-pointer"
                  >
                    توليد عشوائي / Generate New
                  </button>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. d2cb8181-233c-4d18-9972-8a1b04db0044"
                  value={newClientId}
                  onChange={(e) => setNewClientId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 text-slate-100 rounded-xl px-4 py-2.5 text-xs font-mono transition-all outline-none"
                />
              </div>

              {/* Client Duration limit */}
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-2">
                  فترة صلاحية الحساب / Account Duration Period
                </label>
                <select
                  value={newClientDuration}
                  onChange={(e) => setNewClientDuration(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 text-slate-100 rounded-xl px-4 py-2.5 text-xs transition-all outline-none cursor-pointer"
                >
                  <option value="5m">5 دقائق للاختبار / 5 Minutes (Test)</option>
                  <option value="1h">ساعة واحدة / 1 Hour</option>
                  <option value="1d">يوم واحد / 1 Day</option>
                  <option value="7d">أسبوع واحد / 1 Week</option>
                  <option value="30d">شهر واحد / 30 Days (1 Month)</option>
                  <option value="90d">3 أشهر / 90 Days (3 Months)</option>
                  <option value="180d">6 أشهر / 180 Days (6 Months)</option>
                  <option value="365d">عام واحد / 365 Days (1 Year)</option>
                  <option value="unlimited">غير محدود / Unlimited Time</option>
                </select>
              </div>

              {/* Form Controls */}
              <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="bg-slate-950 border border-slate-850 hover:bg-slate-850 text-slate-300 font-semibold px-4 py-2.5 rounded-xl text-xs transition-all cursor-pointer"
                >
                  إلغاء / Cancel
                </button>
                <button
                  type="submit"
                  className="bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-600 text-slate-950 font-bold px-5 py-2.5 rounded-xl text-xs transition-all cursor-pointer"
                >
                  تأكيد وإضافة / Add Client
                </button>
              </div>

            </form>
          </motion.div>
        </div>
      )}

      {/* MODAL: QR CODE & CONNECTION DATA */}
      {selectedClientForQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col relative"
          >
            <div className="border-b border-slate-800 p-5 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <QrCode className="w-5 h-5 text-cyan-400" />
                  <span>تفاصيل الاتصال بالمشترك / Client Connection Profile</span>
                </h3>
                <p className="text-[11px] text-slate-400 font-mono mt-0.5">{selectedClientForQr.email}</p>
              </div>
              <button 
                onClick={() => setSelectedClientForQr(null)}
                className="text-slate-500 hover:text-white transition-colors cursor-pointer text-sm"
              >
                إغلاق / Close
              </button>
            </div>

            <div className="p-5 md:p-6 grid grid-cols-1 md:grid-cols-12 gap-6 overflow-y-auto max-h-[70vh] terminal-scrollbar">
              
              {/* Col Left: QR Code */}
              <div className="md:col-span-5 flex flex-col items-center justify-center gap-3 bg-slate-950 rounded-xl p-5 border border-slate-850">
                {qrCodeDataUrl ? (
                  <div className="bg-white p-1.5 rounded-lg shadow-inner">
                    <img src={qrCodeDataUrl} alt="VLESS QR Code" className="w-[180px] h-[180px]" />
                  </div>
                ) : (
                  <div className="w-[180px] h-[180px] flex items-center justify-center text-slate-500 text-xs">
                    Generating QR...
                  </div>
                )}
                
                <p className="text-[10px] text-slate-400 text-center leading-relaxed">
                  قم بمسح الكود بكاميرا تطبيق البروكسي (مثل v2rayNG, Shadowrocket) للاستيراد السريع.
                </p>

                {/* Secure toggle */}
                <div className="flex items-center gap-2 mt-2 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 w-full justify-between">
                  <span className="text-[10px] text-slate-300">Secure (TLS/443)</span>
                  <button 
                    type="button"
                    onClick={() => setIsSecureLink(prev => !prev)}
                    className="text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    {isSecureLink ? (
                      <ToggleRight className="w-8 h-8 text-cyan-400" />
                    ) : (
                      <ToggleLeft className="w-8 h-8 text-slate-600" />
                    )}
                  </button>
                </div>
              </div>

              {/* Col Right: Copy configurations */}
              <div className="md:col-span-7 space-y-4 flex flex-col justify-between">
                
                {/* VLESS URI link string */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex justify-between items-center">
                    <span>رابط الاتصال المباشر / VLESS URI Link</span>
                    <button
                      onClick={() => copyToClipboard(getVlessUri(selectedClientForQr.id, selectedClientForQr.email, isSecureLink), "uri")}
                      className="text-cyan-400 hover:text-cyan-300 text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      {copiedText === "uri" ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>تم النسخ! / Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>نسخ الرابط / Copy Link</span>
                        </>
                      )}
                    </button>
                  </label>

                  <div className="bg-slate-950 border border-slate-850 rounded-xl p-3 font-mono text-[10px] text-slate-300 select-all overflow-x-auto whitespace-normal break-all max-h-[100px] terminal-scrollbar">
                    {getVlessUri(selectedClientForQr.id, selectedClientForQr.email, isSecureLink)}
                  </div>
                </div>

                {/* Client configuration JSON */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex justify-between items-center">
                    <span>تكوين خيارات البروكسي (JSON) / Client Config Block</span>
                    <button
                      onClick={() => copyToClipboard(getClientJson(selectedClientForQr.id, selectedClientForQr.email, isSecureLink), "json")}
                      className="text-cyan-400 hover:text-cyan-300 text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      {copiedText === "json" ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>تم النسخ! / Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>نسخ التكوين / Copy Block</span>
                        </>
                      )}
                    </button>
                  </label>

                  <div className="bg-slate-950 border border-slate-850 rounded-xl p-3 font-mono text-[9px] text-slate-400 overflow-y-auto max-h-[150px] terminal-scrollbar whitespace-pre">
                    {getClientJson(selectedClientForQr.id, selectedClientForQr.email, isSecureLink)}
                  </div>
                </div>

              </div>

            </div>

            <div className="bg-slate-950 border-t border-slate-850 px-5 py-4 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedClientForQr(null)}
                className="bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 px-5 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer"
              >
                إغلاق / Close
              </button>
            </div>

          </motion.div>
        </div>
      )}

    </div>
  );
}
