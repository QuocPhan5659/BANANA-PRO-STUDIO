import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Banana, Loader2, Wand2, RefreshCw, Download, Trash2, Upload, X, Image as ImageIcon, LogIn, LogOut, User as UserIcon, ShieldCheck, Zap, Star, MessageSquare, Send, ExternalLink, Sparkles, Mail, Lock, UserPlus, Paperclip, Pencil, Check } from 'lucide-react';
import { generateBananaImage, generateCreativePrompt, chatWithGemini } from './services/geminiService';
import { GeneratedImage } from './types';
import { auth, signInWithGoogle, logout, getAccountTier, AccountTier, signUpWithEmail, loginWithEmail, db } from './services/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, getDocFromServer, onSnapshot, setDoc, updateDoc, deleteDoc, query, orderBy, getDocs, Timestamp } from 'firebase/firestore';
import Markdown from 'react-markdown';
import { extractPngInfo, injectPngInfo } from './services/pngService';

interface UploadedImage {
  preview: string; // Full data URL for display
  data: string;    // Base64 string for API
  mimeType: string;
}

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  sources?: any[];
  image?: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>({ 
    displayName: 'Guest Banana', 
    photoURL: 'https://picsum.photos/seed/banana/100/100',
    email: 'guest@example.com'
  } as any);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [tier, setTier] = useState<AccountTier>('Free');
  const [activeTab, setActiveTab] = useState<'lab' | 'chat'>('lab');
  const [isGuest, setIsGuest] = useState<boolean>(true);

  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth?.currentUser?.uid,
        email: auth?.currentUser?.email,
        emailVerified: auth?.currentUser?.emailVerified,
        isAnonymous: auth?.currentUser?.isAnonymous,
        tenantId: auth?.currentUser?.tenantId,
        providerInfo: auth?.currentUser?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL
        })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  };

  useEffect(() => {
    async function testConnection() {
      if (!db) return;
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  // Image Config State
  const [aspectRatio, setAspectRatio] = useState<string>("1:1");
  const [customAspectRatio, setCustomAspectRatio] = useState<string>("2:1");

  // Auth Form State
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Image Gen State
  const [prompt, setPrompt] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [currentImage, setCurrentImage] = useState<GeneratedImage | null>(null);
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(null);
  const [zoomedImageUrl, setZoomedImageUrl] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState<number>(1);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isChatDragging, setIsChatDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // Chat State
  const [chatInput, setChatInput] = useState<string>('');
  const [chatUploadedImage, setChatUploadedImage] = useState<UploadedImage | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem('banana_chat_sessions');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Filter out sessions older than 24h
          const now = Date.now();
          return parsed.filter((s: ChatSession) => s && s.createdAt && now - s.createdAt < 24 * 60 * 60 * 1000);
        }
      } catch (e) {
        console.error('Failed to parse chat sessions from localStorage:', e);
        localStorage.removeItem('banana_chat_sessions');
      }
    }
    return [];
  });
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  // Derived state for current messages
  const currentSession = chatSessions.find(s => s.id === currentSessionId);
  const chatMessages = currentSession?.messages || [];

  useEffect(() => {
    localStorage.setItem('banana_chat_sessions', JSON.stringify(chatSessions));
  }, [chatSessions]);

  // Auto-delete timer (check every minute)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setChatSessions(prev => {
        const filtered = prev.filter(s => now - s.createdAt < 24 * 60 * 60 * 1000);
        if (filtered.length !== prev.length) {
          return filtered;
        }
        return prev;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const createNewSession = () => {
    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: `New Chat ${chatSessions.length + 1}`,
      messages: [],
      createdAt: Date.now()
    };
    setChatSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setChatSessions(prev => prev.filter(s => s.id !== id));
    if (currentSessionId === id) {
      setCurrentSessionId(null);
    }
  };

  const handleRenameSession = (id: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    setChatSessions(prev => prev.map(s => s.id === id ? { ...s, title: newTitle } : s));
    setEditingSessionId(null);
  };

  useEffect(() => {
    if (chatSessions.length > 0 && !currentSessionId) {
      setCurrentSessionId(chatSessions[0].id);
    }
  }, [chatSessions, currentSessionId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    if (promptRef.current) {
      promptRef.current.style.height = 'auto';
      promptRef.current.style.height = `${promptRef.current.scrollHeight}px`;
    }
  }, [prompt]);

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setTier(getAccountTier(currentUser));
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (zoomedImageUrl) {
        if (e.key === 'Escape' || e.key === ' ') {
          e.preventDefault();
          setZoomedImageUrl(null);
          setZoomScale(1);
        }
      }
    };

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
            const blob = items[i].getAsFile();
            if (blob) {
              if (activeTab === 'lab') {
                processFile(blob);
              } else {
                handleChatImageUpload(blob);
              }
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handlePaste);
    };
  }, [zoomedImageUrl, activeTab]);

  const handleLogin = async () => {
    try {
      await signInWithGoogle();
      setIsGuest(false);
    } catch (err) {
      setError("Failed to sign in. Please try again.");
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSubmitting(true);
    try {
      if (authMode === 'signup') {
        if (!name.trim()) throw new Error("Name is required");
        await signUpWithEmail(email, password, name);
      } else {
        await loginWithEmail(email, password);
      }
      setIsGuest(false);
    } catch (err: any) {
      setAuthError(err.message || "Authentication failed");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      if (isGuest) {
        setUser(null);
        setIsGuest(false);
      } else {
        await logout();
      }
      setHistory([]);
      setCurrentImage(null);
      setChatSessions([]);
      setCurrentSessionId(null);
    } catch (err) {
      setError("Failed to sign out.");
    }
  };

  const handleResetAccount = async () => {
    if (window.confirm("Are you sure? This will clear all your history and log you out to start fresh.")) {
      localStorage.clear();
      await handleLogout();
      window.location.reload();
    }
  };

  const handleChangeEmail = async () => {
    const newEmail = window.prompt("Enter new email address:");
    if (newEmail && newEmail.includes('@')) {
      alert("Email change request sent! (Note: In a real app, this would trigger a Firebase updateEmail call)");
      // In a real app: await updateEmail(auth.currentUser, newEmail);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError("Please upload a valid image file (PNG, JPEG, etc).");
      return;
    }
    
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const matches = result.match(/^data:(.+);base64,(.+)$/);
      if (matches) {
        const mimeType = matches[1];
        setUploadedImage({
          preview: result,
          mimeType: mimeType,
          data: matches[2]
        });
        setError(null);

        // Detect aspect ratio
        const img = new Image();
        img.onload = () => {
          const ratio = img.width / img.height;
          if (Math.abs(ratio - 1) < 0.1) setAspectRatio("1:1");
          else if (Math.abs(ratio - 0.75) < 0.1) setAspectRatio("3:4");
          else if (Math.abs(ratio - 1.33) < 0.1) setAspectRatio("4:3");
          else if (Math.abs(ratio - 0.56) < 0.1) setAspectRatio("9:16");
          else if (Math.abs(ratio - 1.77) < 0.1) setAspectRatio("16:9");
          else if (Math.abs(ratio - 1.5) < 0.1) setAspectRatio("3:2");
          else if (Math.abs(ratio - 0.66) < 0.1) setAspectRatio("2:3");
          else {
            setAspectRatio("custom");
            setCustomAspectRatio(`${img.width}:${img.height}`);
          }
        };
        img.src = result;

        // Extract PNG info if it's a PNG
        if (mimeType === 'image/png') {
          const info = extractPngInfo(result);
          if (info) {
            setPrompt(info);
          }
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const clearUploadedImage = () => {
    setUploadedImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePromptDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const info = extractPngInfo(result);
        if (info) {
          setPrompt(info);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || !user) return;
    
    setLoading(true);
    setError(null);
    try {
      const finalPrompt = prompt.toLowerCase().includes('banana') 
        ? prompt 
        : `A banana ${prompt}`;

      const referenceImage = uploadedImage ? { 
        data: uploadedImage.data, 
        mimeType: uploadedImage.mimeType 
      } : undefined;

      const finalAspectRatio = aspectRatio === 'custom' ? customAspectRatio : aspectRatio;

      const imageBase64 = await generateBananaImage(finalPrompt, {
        referenceImage,
        aspectRatio: finalAspectRatio as any
      });
      
      const newImage: GeneratedImage = {
        id: Date.now().toString(),
        data: imageBase64,
        prompt: finalPrompt,
        timestamp: Date.now(),
      };

      setCurrentImage(newImage);
      setHistory(prev => [newImage, ...prev]);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to generate banana. The peel was too slippery.');
    } finally {
      setLoading(false);
    }
  }, [prompt, uploadedImage, user]);

  const handleDeleteImage = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory(prev => prev.filter(img => img.id !== id));
    if (currentImage?.id === id) {
      setCurrentImage(null);
    }
  };

  const handleSurpriseMe = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    setPrompt("Thinking of a peeled idea...");
    try {
      const creativePrompt = await generateCreativePrompt();
      setPrompt(creativePrompt);
      
      const finalAspectRatio = aspectRatio === 'custom' ? customAspectRatio : aspectRatio;

      const imageBase64 = await generateBananaImage(creativePrompt, {
        aspectRatio: finalAspectRatio as any
      });
      const newImage: GeneratedImage = {
        id: Date.now().toString(),
        data: imageBase64,
        prompt: creativePrompt,
        timestamp: Date.now(),
      };

      setCurrentImage(newImage);
      setHistory(prev => [newImage, ...prev]);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Failed to dream of bananas.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const handleDownload = (dataUrl: string, filename: string, prompt?: string) => {
    let finalDataUrl = dataUrl;
    // Inject PNG info if it's a PNG and we have a prompt
    if (prompt && dataUrl.startsWith('data:image/png')) {
      finalDataUrl = injectPngInfo(dataUrl, prompt);
    }

    const link = document.createElement('a');
    link.href = finalDataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClearHistory = () => {
    setHistory([]);
    setCurrentImage(null);
  };

  const handleSendMessage = async () => {
    if ((!chatInput.trim() && !chatUploadedImage) || chatLoading) return;

    const userMessageText = chatInput.trim();
    const currentChatImage = chatUploadedImage;
    
    const userMessage: ChatMessage = {
      role: 'user',
      text: userMessageText || (currentChatImage ? "Analyze this image" : ""),
      image: currentChatImage?.preview
    };

    // Determine target session ID beforehand to avoid race conditions
    let targetSessionId = currentSessionId;
    let isNew = false;
    if (!targetSessionId) {
      targetSessionId = Date.now().toString();
      isNew = true;
    }

    // Capture history for API call BEFORE updating state
    const currentHistory = isNew ? [] : [...chatMessages].map(m => ({
      role: m.role,
      parts: [{ text: m.text }]
    }));

    // Update sessions state
    setChatSessions(prev => {
      if (isNew) {
        const newSession: ChatSession = {
          id: targetSessionId!,
          title: userMessageText.slice(0, 30) || 'New Chat',
          messages: [userMessage],
          createdAt: Date.now()
        };
        return [newSession, ...prev];
      }
      return prev.map(s => {
        if (s.id === targetSessionId) {
          return { ...s, messages: [...s.messages, userMessage] };
        }
        return s;
      });
    });

    if (isNew) {
      setCurrentSessionId(targetSessionId);
    }

    setChatInput('');
    setChatUploadedImage(null);
    setChatLoading(true);

    try {
      const imageParam = currentChatImage ? {
        data: currentChatImage.data,
        mimeType: currentChatImage.mimeType
      } : undefined;

      const result = await chatWithGemini(userMessage.text, currentHistory as any, imageParam);
      
      const modelMessage: ChatMessage = {
        role: 'model',
        text: result.text,
        sources: result.sources
      };

      setChatSessions(prev => prev.map(s => {
        if (s.id === targetSessionId) {
          const newTitle = s.title.startsWith('New Chat') ? userMessageText.slice(0, 30) : s.title;
          return { ...s, title: newTitle || s.title, messages: [...s.messages, modelMessage] };
        }
        return s;
      }));
    } catch (err) {
      const errorMessage: ChatMessage = { role: 'model', text: "Sorry, I had a slip-up. Can you try again?" };
      setChatSessions(prev => prev.map(s => {
        if (s.id === targetSessionId) {
          return { ...s, messages: [...s.messages, errorMessage] };
        }
        return s;
      }));
    } finally {
      setChatLoading(false);
    }
  };

  const handleChatImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const matches = result.match(/^data:(.+);base64,(.+)$/);
      if (matches) {
        setChatUploadedImage({
          preview: result,
          mimeType: matches[1],
          data: matches[2]
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleChatDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsChatDragging(true);
  };

  const handleChatDragLeave = () => {
    setIsChatDragging(false);
  };

  const handleChatDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsChatDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleChatImageUpload(file);
    }
  };

  const handleZoomScroll = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoomScale(prev => Math.max(0.1, Math.min(5, prev + delta)));
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-dark-900 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Banana size={64} className="text-banana-500 animate-bounce mx-auto" />
          <p className="text-banana-400 font-black text-xl">Peeling the app open...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    const isConfigured = !!process.env.VITE_FIREBASE_API_KEY;

    return (
      <div className="min-h-screen bg-dark-900 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-dark-800 rounded-3xl p-8 shadow-2xl border-4 border-banana-500 text-center space-y-8">
          <div className="space-y-2">
            <Banana size={80} className="text-banana-500 mx-auto animate-wiggle" />
            <h1 className="text-4xl font-black text-banana-500 tracking-tight">BANANA GEN</h1>
            <p className="text-banana-100 font-medium opacity-80">The world's most absurd banana AI generator.</p>
          </div>
          
          <div className="space-y-4">
            {!isConfigured && (
              <div className="bg-amber-900/20 border-2 border-amber-500/30 p-4 rounded-2xl text-left mb-4">
                <p className="text-amber-400 font-bold text-sm mb-1 flex items-center gap-2">
                  <ShieldCheck size={16} /> Configuration Required
                </p>
                <p className="text-amber-200/60 text-[10px] leading-relaxed">
                  Firebase keys are missing. Please add them in <strong>Settings</strong> to enable login.
                </p>
              </div>
            )}

            <div className="space-y-6">
              <h2 className="text-xl font-black text-banana-500 uppercase tracking-widest">Login to Banana Gen</h2>

              <form onSubmit={handleEmailAuth} className="space-y-3 text-left">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-banana-500" size={18} />
                  <input 
                    type="email" 
                    placeholder="Email Address"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-dark-800 bg-dark-900 text-white focus:border-banana-500 outline-none transition-all"
                  />
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-banana-500" size={18} />
                  <input 
                    type="password" 
                    placeholder="Password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-dark-800 bg-dark-900 text-white focus:border-banana-500 outline-none transition-all"
                  />
                </div>
                
                {authError && <p className="text-red-400 text-xs font-bold">{authError}</p>}

                <button 
                  type="submit"
                  disabled={authSubmitting}
                  className="w-full bg-banana-500 text-dark-900 font-black py-3 rounded-xl hover:bg-banana-400 transition-all flex items-center justify-center gap-2"
                >
                  {authSubmitting ? <Loader2 className="animate-spin" size={20} /> : <LogIn size={20} />}
                  LOGIN
                </button>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-dark-800"></div></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="bg-dark-800 px-2 text-banana-500/40 font-bold">Or continue with</span></div>
              </div>

              <button 
                onClick={handleLogin}
                className="w-full bg-dark-900 border-2 border-dark-800 hover:border-banana-500 text-white font-bold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-3"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
                GOOGLE
              </button>

              <button 
                onClick={() => {
                  setUser({ 
                    displayName: 'Guest Banana', 
                    photoURL: 'https://picsum.photos/seed/banana/100/100',
                    email: 'guest@example.com'
                  } as any);
                  setTier('Free');
                  setIsGuest(true);
                }}
                className="w-full text-banana-500/60 font-bold text-sm hover:underline"
              >
                Continue as guest
              </button>
            </div>
          </div>

          <div className="pt-4 border-t-2 border-dark-800 flex justify-center gap-4">
             <div className="flex flex-col items-center">
               <ShieldCheck className="text-green-500" size={20} />
               <span className="text-[10px] font-bold text-banana-500/40 uppercase">Secure</span>
             </div>
             <div className="flex flex-col items-center">
               <Zap className="text-banana-500" size={20} />
               <span className="text-[10px] font-bold text-banana-500/40 uppercase">Fast</span>
             </div>
             <div className="flex flex-col items-center">
               <Star className="text-purple-500" size={20} />
               <span className="text-[10px] font-bold text-banana-500/40 uppercase">Absurd</span>
             </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-sans bg-dark-900 text-white">
      {/* Header */}
      <header className="bg-dark-800 text-banana-500 p-6 shadow-lg sticky top-0 z-50 border-b border-dark-800">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Banana size={40} className="text-banana-500 animate-wiggle" />
            <h1 className="text-3xl font-black tracking-tight">BANANA GEN</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end">
              <span className="text-[10px] font-black text-banana-500/40 uppercase tracking-widest">Account Status</span>
              <div className={`text-xs font-bold px-2 py-0.5 rounded-full border-2 border-banana-500 flex items-center gap-1 ${
                tier === 'Plus' ? 'bg-purple-500 text-white' : 
                tier === 'Pro' ? 'bg-blue-500 text-white' : 
                'bg-dark-900 text-banana-500'
              }`}>
                {tier === 'Plus' && <Star size={10} />}
                {tier === 'Pro' && <Zap size={10} />}
                {tier.toUpperCase()}
              </div>
            </div>
            
            <div className="flex items-center gap-3 bg-dark-900 p-1.5 rounded-2xl border border-dark-800">
              {user.photoURL ? (
                <img 
                  src={user.photoURL} 
                  alt={user.displayName || 'User'} 
                  className="w-8 h-8 rounded-xl border-2 border-banana-500 shadow-sm object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-8 h-8 rounded-xl border-2 border-banana-500 shadow-sm bg-dark-800 flex items-center justify-center text-banana-500">
                  <UserIcon size={14} />
                </div>
              )}
              <button 
                onClick={handleLogout}
                className="p-2 hover:bg-red-500 hover:text-white rounded-xl transition-colors text-banana-500"
                title="Logout"
              >
                <LogOut size={20} />
              </button>
              <button 
                onClick={handleResetAccount}
                className="p-2 hover:bg-banana-500 hover:text-dark-900 rounded-xl transition-colors text-banana-500/40"
                title="Reset & Switch Account"
              >
                <RefreshCw size={16} />
              </button>
              {!isGuest && (
                <button 
                  onClick={handleChangeEmail}
                  className="p-2 hover:bg-banana-500 hover:text-dark-900 rounded-xl transition-colors text-banana-500/40"
                  title="Change Email"
                >
                  <Mail size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow max-w-[95%] mx-auto w-full p-4 sm:p-6 space-y-6">
        
        {/* Tab Navigation */}
        <div className="flex bg-dark-800 p-1 rounded-2xl border-2 border-dark-800">
          <button 
            onClick={() => setActiveTab('lab')}
            className={`flex-1 py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all ${activeTab === 'lab' ? 'bg-banana-500 text-dark-900 shadow-md' : 'text-banana-500/50 hover:text-banana-500'}`}
          >
            <Wand2 size={18} />
            BANANA LAB
          </button>
          <button 
            onClick={() => setActiveTab('chat')}
            className={`flex-1 py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all ${activeTab === 'chat' ? 'bg-banana-500 text-dark-900 shadow-md' : 'text-banana-500/50 hover:text-banana-500'}`}
          >
            <MessageSquare size={18} />
            BANANA CHAT
          </button>
        </div>

        {activeTab === 'lab' ? (
          <div className="space-y-8 animate-in slide-in-from-left duration-300">
            {/* Controls Section */}
            <section className="bg-dark-800 rounded-3xl p-6 shadow-xl border-4 border-dark-800">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Column: Upload */}
                <div className="flex flex-col space-y-4">
                  <label className="text-banana-500 font-bold text-lg flex items-center gap-2">
                    <span className="bg-banana-500 w-8 h-8 rounded-full flex items-center justify-center text-sm text-dark-900">1</span>
                    Reference Image (Drag & Drop):
                  </label>
                  
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all gap-2 h-[200px] relative overflow-hidden ${
                      isDragging ? 'border-banana-500 bg-banana-500/10' : 'border-banana-500/30 hover:bg-dark-900 text-banana-500/60'
                    }`}
                  >
                    {!uploadedImage ? (
                      <>
                        <ImageIcon size={32} />
                        <span className="font-semibold text-center">Click or Drag Image here</span>
                      </>
                    ) : (
                      <div className="relative w-full h-full flex items-center justify-center">
                        <img 
                          src={uploadedImage.preview} 
                          alt="Uploaded reference" 
                          className="max-h-full max-w-full object-contain cursor-zoom-in"
                          onClick={(e) => {
                            e.stopPropagation();
                            setZoomedImageUrl(uploadedImage.preview);
                          }}
                        />
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            clearUploadedImage();
                          }}
                          className="absolute top-0 right-0 bg-red-500 text-white p-1 rounded-full hover:bg-red-600 transition-colors shadow-sm z-10"
                          title="Remove image"
                        >
                          <X size={16} />
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(uploadedImage.preview, `reference-${Date.now()}.png`, prompt);
                          }}
                          className="absolute top-0 left-0 bg-banana-500 text-dark-900 p-1 rounded-full hover:bg-banana-400 transition-colors shadow-sm z-10"
                          title="Download with Metadata"
                        >
                          <Download size={16} />
                        </button>
                      </div>
                    )}
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleImageUpload} 
                      accept="image/*" 
                      className="hidden" 
                    />
                  </div>
                </div>

                {/* Right Column: Prompt */}
                <div className="flex flex-col space-y-4">
                  <label className="text-banana-500 font-bold text-lg flex items-center gap-2">
                    <span className="bg-banana-500 w-8 h-8 rounded-full flex items-center justify-center text-sm text-dark-900">2</span>
                    Banana Vision:
                  </label>
                  <div className="flex flex-col gap-4 flex-grow">
                    <textarea 
                      ref={promptRef}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={handlePromptDrop}
                      placeholder="e.g., A banana wearing a tuxedo..."
                      className="w-full p-4 rounded-xl border-2 border-dark-900 bg-dark-900 focus:border-banana-500 focus:ring-4 focus:ring-banana-500/10 transition-all outline-none text-lg text-white placeholder-banana-500/20 resize-none overflow-hidden"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.ctrlKey) {
                          e.preventDefault();
                          handleGenerate();
                        }
                      }}
                    />
                    <div className="text-[10px] text-banana-500/40 font-bold text-right -mt-3 mr-2">
                      Press Ctrl + Enter to Generate
                    </div>
                    
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="flex gap-2 w-full">
                        <select 
                          value={aspectRatio}
                          onChange={(e) => setAspectRatio(e.target.value)}
                          className="flex-grow p-2 rounded-xl border-2 border-dark-900 bg-dark-900 text-xs font-bold text-banana-500 focus:border-banana-500 outline-none"
                        >
                          <option value="1:1">1:1 (Square)</option>
                          <option value="3:4">3:4 (Portrait)</option>
                          <option value="4:3">4:3 (Landscape)</option>
                          <option value="3:2">3:2 (Classic)</option>
                          <option value="2:3">2:3 (Classic Port.)</option>
                          <option value="9:16">9:16 (Story)</option>
                          <option value="16:9">16:9 (Cinematic)</option>
                          <option value="custom">Custom Ratio</option>
                        </select>
                        {aspectRatio === 'custom' && (
                          <input 
                            type="text"
                            value={customAspectRatio}
                            onChange={(e) => setCustomAspectRatio(e.target.value)}
                            placeholder="W:H (e.g. 2:1)"
                            className="w-24 p-2 rounded-xl border-2 border-dark-900 bg-dark-900 text-xs font-bold text-banana-500 focus:border-banana-500 outline-none"
                          />
                        )}
                      </div>
                      <button 
                        onClick={handleGenerate}
                        disabled={loading || !prompt}
                        className="bg-banana-500 hover:bg-banana-400 disabled:opacity-50 disabled:cursor-not-allowed text-dark-900 font-black py-3 px-6 rounded-xl shadow-[0_4px_0_rgb(183,149,11)] active:shadow-none active:translate-y-[4px] transition-all flex items-center justify-center gap-2 whitespace-nowrap w-full sm:w-auto"
                      >
                        {loading ? <Loader2 className="animate-spin" /> : <Wand2 />}
                        BANANA FREE
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-between items-center border-t border-dark-900 pt-4">
                <button 
                  onClick={handleSurpriseMe}
                  disabled={loading}
                  className="text-banana-500/60 hover:text-banana-500 font-bold text-sm flex items-center gap-2 hover:underline decoration-2 underline-offset-4"
                >
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                  Surprise me
                </button>
                
                {error && (
                  <div className="bg-red-900/20 text-red-400 px-4 py-2 rounded-xl border border-red-500/30 text-xs">
                    {error}
                  </div>
                )}
              </div>
            </section>

            {/* Display & History Side-by-Side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Display Section (Matches Reference Image width) */}
              <div className="flex flex-col space-y-4">
                <label className="text-banana-500 font-bold text-lg flex items-center gap-2">
                  <span className="bg-banana-500 w-8 h-8 rounded-full flex items-center justify-center text-sm text-dark-900">3</span>
                  Banana Output:
                </label>
                {currentImage ? (
                  <section className="animate-in fade-in zoom-in duration-500">
                    <div className="bg-dark-800 p-4 rounded-3xl shadow-2xl border-4 border-dark-800">
                      <div className="aspect-square w-full rounded-2xl overflow-hidden bg-dark-900 relative">
                        <img 
                          src={currentImage.data} 
                          alt={currentImage.prompt} 
                          className="w-full h-full object-cover cursor-zoom-in"
                          onClick={() => setZoomedImageUrl(currentImage.data)}
                        />
                      </div>
                      <div className="mt-4">
                        <button 
                          onClick={() => handleDownload(currentImage.data, `banana-${currentImage.timestamp}.png`, currentImage.prompt)}
                          className="bg-banana-500 text-dark-900 px-4 py-3 rounded-xl hover:bg-banana-400 transition-all flex items-center justify-center gap-2 font-black shadow-lg w-full text-sm"
                        >
                          <Download size={18} />
                          DOWNLOAD IMAGE
                        </button>
                      </div>
                    </div>
                  </section>
                ) : (
                  <div className="bg-dark-800/50 border-2 border-dashed border-dark-800 rounded-3xl h-[300px] flex flex-col items-center justify-center text-banana-500/20 gap-2">
                    <ImageIcon size={48} />
                    <span className="font-bold">Waiting for magic...</span>
                  </div>
                )}
              </div>

              {/* History Gallery (Matches Vision width) */}
              <div className="flex flex-col space-y-4">
                <label className="text-banana-500 font-bold text-lg flex items-center gap-2">
                  <span className="bg-banana-500 w-8 h-8 rounded-full flex items-center justify-center text-sm text-dark-900">4</span>
                  The Bunch (History):
                </label>
                {history.length > 0 ? (
                  <section className="bg-dark-800 p-6 rounded-3xl shadow-xl border-4 border-dark-800 flex-grow">
                    <div className="flex justify-between items-center mb-4">
                      <h2 className="text-sm font-black text-banana-500/60 uppercase tracking-widest">Recent Generations</h2>
                      <button 
                        onClick={handleClearHistory}
                        className="text-red-500/60 hover:text-red-500 flex items-center gap-1 text-[10px] font-bold uppercase"
                      >
                        <Trash2 size={12} /> Clear All
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
                      {history.map((img) => (
                        <div 
                          key={img.id} 
                          onClick={() => {
                            setCurrentImage(img);
                            setZoomedImageUrl(null);
                          }}
                          className={`group relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all hover:scale-105 active:scale-95 ${currentImage?.id === img.id ? 'border-banana-500 ring-2 ring-banana-500/20 shadow-lg' : 'border-dark-800 hover:border-banana-500/30'}`}
                        >
                          <img src={img.data} alt={img.prompt} className="w-full h-full object-cover aspect-square" />
                          
                          {/* Hover Actions */}
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleDownload(img.data, `banana-${img.timestamp}.png`, img.prompt); }}
                              className="p-1.5 bg-banana-500 text-dark-900 rounded-md hover:bg-banana-400"
                              title="Download"
                            >
                              <Download size={12} />
                            </button>
                            <button 
                              onClick={(e) => handleDeleteImage(img.id, e)}
                              className="p-1.5 bg-red-500 text-white rounded-md hover:bg-red-400"
                              title="Delete"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : (
                  <div className="bg-dark-800/50 border-2 border-dashed border-dark-800 rounded-3xl flex-grow flex flex-col items-center justify-center text-banana-500/20 gap-2 min-h-[200px]">
                    <Banana size={48} />
                    <span className="font-bold">Your bunch is empty</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row h-[800px] gap-4 animate-in slide-in-from-right duration-300">
            {/* Main Chat Area */}
            <div className="flex-grow flex flex-col bg-dark-800 rounded-3xl shadow-xl border-4 border-dark-800 overflow-hidden">
              {/* Chat Messages */}
              <div className="flex-grow overflow-y-auto p-6 space-y-6 bg-dark-900/50">
                {chatMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                    <Sparkles size={64} className="text-banana-500" />
                    <div>
                      <h3 className="text-xl font-black text-banana-500">BANANA CHAT</h3>
                      <p className="text-banana-100 font-medium max-w-xs">Ask me anything! I have search grounding and a very yellow personality.</p>
                    </div>
                  </div>
                ) : (
                  chatMessages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${
                        msg.role === 'user' 
                          ? 'bg-banana-500 text-dark-900 rounded-tr-none' 
                          : 'bg-dark-900 border-2 border-dark-800 text-white rounded-tl-none'
                      }`}>
                        {msg.image && (
                          <div className="mb-3 rounded-xl overflow-hidden border-2 border-dark-800/20">
                            <img 
                              src={msg.image} 
                              alt="Chat attachment" 
                              className="max-h-64 w-auto object-contain cursor-zoom-in"
                              onClick={() => setZoomedImageUrl(msg.image!)}
                            />
                          </div>
                        )}
                        <div className="markdown-body prose prose-invert prose-sm max-w-none">
                          <Markdown>{msg.text}</Markdown>
                        </div>
                        
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-dark-800 flex flex-wrap gap-2">
                            {msg.sources.map((source: any, sIdx: number) => (
                              <a 
                                key={sIdx} 
                                href={source.uri} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-[10px] font-bold bg-dark-800 hover:bg-dark-700 text-banana-500 px-2 py-1 rounded-full flex items-center gap-1 transition-colors"
                              >
                                <ExternalLink size={10} />
                                {source.title || 'Source'}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-dark-900 border-2 border-dark-800 p-4 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2">
                      <Loader2 size={20} className="animate-spin text-banana-500" />
                      <span className="text-sm font-bold text-banana-500">Peeling back the answers...</span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input */}
              <div 
                className={`p-4 bg-dark-800 border-t-2 border-dark-800 transition-colors ${isChatDragging ? 'bg-banana-500/10 border-banana-500' : ''}`}
                onDragOver={handleChatDragOver}
                onDragLeave={handleChatDragLeave}
                onDrop={handleChatDrop}
              >
                {chatUploadedImage && (
                  <div className="mb-4 relative inline-block">
                    <img 
                      src={chatUploadedImage.preview} 
                      alt="Chat preview" 
                      className="h-20 w-20 object-cover rounded-xl border-2 border-banana-500"
                    />
                    <button 
                      onClick={() => setChatUploadedImage(null)}
                      className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full shadow-lg"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
                <div className="flex gap-2">
                  <button 
                    onClick={() => chatFileInputRef.current?.click()}
                    className="bg-dark-900 text-banana-500 p-4 rounded-xl border-2 border-dark-900 hover:border-banana-500 transition-all"
                    title="Upload Image"
                  >
                    <Paperclip size={24} />
                    <input 
                      type="file" 
                      ref={chatFileInputRef} 
                      onChange={(e) => e.target.files?.[0] && handleChatImageUpload(e.target.files[0])} 
                      accept="image/*" 
                      className="hidden" 
                    />
                  </button>
                  <input 
                    type="text" 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="Ask Banana Gemini anything..."
                    className="flex-grow p-4 rounded-xl border-2 border-dark-900 bg-dark-900 focus:border-banana-500 focus:ring-4 focus:ring-banana-500/10 transition-all outline-none text-white"
                  />
                  <button 
                    onClick={handleSendMessage}
                    disabled={chatLoading || (!chatInput.trim() && !chatUploadedImage)}
                    className="bg-banana-500 hover:bg-banana-400 disabled:opacity-50 text-dark-900 p-4 rounded-xl shadow-[0_4px_0_rgb(183,149,11)] active:shadow-none active:translate-y-[4px] transition-all"
                  >
                    <Send size={24} />
                  </button>
                </div>
              </div>
            </div>

            {/* Right Sidebar: Chat History */}
            <div className="w-full lg:w-72 flex flex-col bg-dark-800 rounded-3xl shadow-xl border-4 border-dark-800 overflow-hidden">
              <div className="p-4 border-b-2 border-dark-900 flex justify-between items-center">
                <h3 className="text-banana-500 font-black text-sm uppercase tracking-wider">Chat History</h3>
                <button 
                  onClick={createNewSession}
                  className="bg-banana-500 text-dark-900 p-2 rounded-lg hover:bg-banana-400 transition-colors"
                  title="New Chat"
                >
                  <UserPlus size={16} />
                </button>
              </div>
              <div className="flex-grow overflow-y-auto p-2 space-y-2">
                {chatSessions.length === 0 ? (
                  <div className="text-center py-10 opacity-20">
                    <MessageSquare size={32} className="mx-auto mb-2" />
                    <p className="text-xs font-bold">No chats yet</p>
                  </div>
                ) : (
                  chatSessions.map(session => (
                    <div 
                      key={session.id}
                      onClick={() => setCurrentSessionId(session.id)}
                      className={`group p-3 rounded-xl cursor-pointer transition-all border-2 flex justify-between items-center ${currentSessionId === session.id ? 'bg-banana-500/10 border-banana-500 text-banana-500' : 'bg-dark-900 border-dark-900 text-banana-500/40 hover:border-banana-500/30'}`}
                    >
                      {editingSessionId === session.id ? (
                        <div className="flex items-center gap-1 w-full" onClick={e => e.stopPropagation()}>
                          <input 
                            type="text"
                            value={editingTitle}
                            onChange={e => setEditingTitle(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleRenameSession(session.id, editingTitle)}
                            className="bg-dark-900 text-xs font-black p-1 rounded border border-banana-500 outline-none w-full text-white"
                            autoFocus
                          />
                          <button onClick={() => handleRenameSession(session.id, editingTitle)} className="text-green-500 p-1 hover:bg-green-500/20 rounded">
                            <Check size={14} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-col overflow-hidden">
                            <span className="text-xs font-black truncate">{session.title}</span>
                            <span className="text-[10px] opacity-50">
                              {new Date(session.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingSessionId(session.id);
                                setEditingTitle(session.title);
                              }}
                              className="p-1 hover:bg-banana-500 hover:text-dark-900 rounded transition-colors"
                              title="Rename"
                            >
                              <Pencil size={12} />
                            </button>
                            <button 
                              onClick={(e) => deleteSession(session.id, e)}
                              className="p-1 hover:bg-red-500 hover:text-white rounded transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
              <div className="p-3 bg-dark-900/50 text-[10px] text-banana-500/30 font-bold text-center italic">
                Chats auto-delete after 24 hours
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-auto py-8 text-center text-banana-500/20 font-medium">
        <p>Generated with Banana Gemini (2.5 Flash Image & 3 Flash Preview)</p>
      </footer>

      {/* Full-screen Zoom Modal */}
      {zoomedImageUrl && (
        <div 
          className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4 cursor-zoom-out animate-in fade-in duration-300"
          onClick={() => {
            setZoomedImageUrl(null);
            setZoomScale(1);
          }}
          onWheel={handleZoomScroll}
        >
          <button 
            className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors z-[110]"
            onClick={() => {
              setZoomedImageUrl(null);
              setZoomScale(1);
            }}
          >
            <X size={40} />
          </button>
          <div 
            className="transition-transform duration-200 ease-out"
            style={{ transform: `scale(${zoomScale})` }}
            onClick={(e) => e.stopPropagation()}
          >
            <img 
              src={zoomedImageUrl} 
              alt="Zoomed" 
              className="max-w-full max-h-full object-contain shadow-2xl rounded-lg"
            />
          </div>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-dark-800/80 text-banana-500 px-4 py-2 rounded-full text-xs font-bold backdrop-blur-md border border-dark-800">
            Scroll to Zoom: {Math.round(zoomScale * 100)}%
          </div>
        </div>
      )}
    </div>
  );
};

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const errorStr = this.state.error.message || String(this.state.error);
        if (errorStr.trim().startsWith('{')) {
          const parsed = JSON.parse(errorStr);
          if (parsed.error?.message) {
            errorMessage = parsed.error.message;
          } else if (parsed.message) {
            errorMessage = parsed.message;
          } else {
            errorMessage = errorStr;
          }
        } else {
          errorMessage = errorStr;
        }
      } catch (e) {
        errorMessage = this.state.error.message || String(this.state.error);
      }

      const isQuotaError = errorMessage.includes("Quota") || errorMessage.includes("RESOURCE_EXHAUSTED") || errorMessage.includes("429");

      return (
        <div className="min-h-screen bg-dark-900 flex items-center justify-center p-4">
          <div className="bg-dark-800 border-2 border-red-500/50 p-8 rounded-3xl max-w-md w-full text-center space-y-4">
            <div className="bg-red-500/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto text-red-500">
              <X size={32} />
            </div>
            <h2 className="text-xl font-black text-white uppercase tracking-widest">
              {isQuotaError ? "Quota Exceeded" : "Application Error"}
            </h2>
            <div className="space-y-2">
              <p className="text-banana-500/60 text-sm font-medium">{errorMessage}</p>
              {isQuotaError && (
                <p className="text-amber-400/80 text-[10px] leading-relaxed">
                  If you are running this on GitHub, please ensure you have set your own <strong>GEMINI_API_KEY</strong> in your environment secrets. The free tier has strict limits and may be unavailable in some regions.
                </p>
              )}
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-banana-500 text-dark-900 font-black py-3 rounded-xl hover:bg-banana-400 transition-all"
            >
              RELOAD APP
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const AppWithBoundary: React.FC = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

export default AppWithBoundary;
