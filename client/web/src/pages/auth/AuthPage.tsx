import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield,
  ChevronDown,
  Search,
  ArrowRight,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Lock,
  Sparkles,
  Phone,
} from 'lucide-react';
import { COUNTRIES, CountryOption } from '@/lib/countries';
import { extractErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { mediaApi } from '@/services/api.services';
import { toast } from '@/stores/toastStore';
import { Avatar } from '@/components/common/Avatar';
import { ImageCropModal } from '@/components/common/ImageCropModal';

type AuthStep = 'welcome' | 'phone' | 'otp' | 'profile' | 'two_factor_challenge' | 'two_factor_setup';

export const AuthPage: React.FC<{ initialStep?: AuthStep }> = ({ initialStep = 'welcome' }) => {
  const navigate = useNavigate();
  const {
    sendOtp,
    verifyOtp,
    register,
    updateProfile,
    verify2FA,
    enable2FA,
    isAuthenticated,
    requires2FA,
    user,
    devOtp,
    clearDevOtp,
    isLoading,
  } = useAuthStore();

  const [step, setStep] = useState<AuthStep>(initialStep);
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Country & Phone
  const [selectedCountry, setSelectedCountry] = useState<CountryOption>(COUNTRIES[0]);
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [regDisplayName, setRegDisplayName] = useState('');
  const [regUsername, setRegUsername] = useState('');

  // OTP
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [countdown, setCountdown] = useState(0);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Profile Setup
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [about, setAbout] = useState('Hey there! I am using WhatsApp Pro.');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // 2FA PIN
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [cropFile, setCropFile] = useState<File | null>(null);

  useEffect(() => {
    if (isAuthenticated && !requires2FA && step !== 'profile' && step !== 'two_factor_setup') {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, requires2FA, step, navigate]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.dialCode.includes(q),
    );
  }, [countrySearch]);

  const fullPhoneNumber = useMemo(() => {
    const cleanDigits = phoneDigits.replace(/\D/g, '').replace(/^0+/, '');
    return `${selectedCountry.dialCode}${cleanDigits}`;
  }, [selectedCountry.dialCode, phoneDigits]);

  const handleSendOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const clean = phoneDigits.replace(/\D/g, '');
    if (clean.length < 6 || clean.length > 14) {
      toast.error('Please enter a valid phone number');
      return;
    }

    if (mode === 'register' && regDisplayName.trim().length < 2) {
      toast.error('Please enter your display name');
      return;
    }

    try {
      clearDevOtp();
      if (mode === 'register') {
        await register({
          phone: fullPhoneNumber,
          country_code: selectedCountry.code,
          display_name: regDisplayName.trim(),
          username: regUsername.trim() || undefined,
        });
        if (!useAuthStore.getState().devOtp) {
          await sendOtp(fullPhoneNumber, selectedCountry.code);
        }
      } else {
        await sendOtp(fullPhoneNumber, selectedCountry.code);
      }
      setCountdown(60);
      setOtpDigits(['', '', '', '', '', '']);
      setStep('otp');
      toast.success(`Verification code sent to ${fullPhoneNumber}`);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send verification code');
    }
  };

  const handleResendOtp = async () => {
    try {
      await sendOtp(fullPhoneNumber, selectedCountry.code);
      setCountdown(60);
      setOtpDigits(['', '', '', '', '', '']);
      toast.success(`New verification code sent to ${fullPhoneNumber}`);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resend verification code');
    }
  };

  const handleFillDevOtp = () => {
    if (!devOtp) return;
    const digits = devOtp.replace(/\D/g, '').slice(0, 6).split('');
    if (digits.length === 6) {
      setOtpDigits(digits);
      otpRefs.current[5]?.focus();
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otpDigits];
    next[index] = digit;
    setOtpDigits(next);
    if (digit && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      e.preventDefault();
      setOtpDigits(pasted.split(''));
      otpRefs.current[5]?.focus();
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otpDigits.join('');
    if (code.length !== 6) {
      toast.error('Enter the full 6-digit OTP code');
      return;
    }

    try {
      const result = await verifyOtp(fullPhoneNumber, code);
      if (result.requires2FA) {
        setPin('');
        setStep('two_factor_challenge');
        return;
      }
      if (result.isNewUser || mode === 'register') {
        setDisplayName(regDisplayName || user?.displayName || '');
        setUsername(regUsername || user?.username || '');
        setStep('profile');
      } else {
        toast.success('Welcome back to WhatsApp Pro!');
        navigate('/', { replace: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid verification code');
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 6) {
      toast.error('Enter your 6-digit PIN');
      return;
    }
    try {
      await verify2FA(pin);
      toast.success('Verified! Welcome back.');
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Incorrect 2FA PIN');
    }
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCropFile(file);
  };

  const handleAvatarCropConfirm = async (croppedBlob: Blob) => {
    setCropFile(null);
    setUploadingAvatar(true);
    try {
      const uploaded = await mediaApi.uploadFile(croppedBlob, 'avatars', undefined, 'avatar.jpg');
      setAvatarUrl(uploaded.url);
      toast.success('Profile photo uploaded');
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to upload avatar'));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      toast.error('Display name is required');
      return;
    }
    try {
      await updateProfile({
        displayName: displayName.trim(),
        username: username.trim() || undefined,
        about: about.trim() || undefined,
        avatarUrl: avatarUrl || undefined,
      });
      setStep('two_factor_setup');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile');
    }
  };

  const handleSetup2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 6) {
      toast.error('PIN must be 6 digits');
      return;
    }
    if (pin !== confirmPin) {
      toast.error('PINs do not match');
      return;
    }
    try {
      await enable2FA(pin);
      toast.success('Two-Step Verification enabled!');
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to enable 2FA');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f0f2f5] dark:bg-[#0b141a] text-[#111b21] dark:text-[#e9edef]">
      {/* Top Green Header Strip */}
      <div className="h-44 bg-[#00A884] dark:bg-[#008069] w-full shrink-0" />

      <div className="flex-1 flex items-start justify-center px-4 -mt-32 pb-12">
        <div className="bg-white dark:bg-[#202c33] rounded-2xl shadow-xl border border-gray-200/80 dark:border-[#2a3942] max-w-lg w-full overflow-hidden">
          {/* Welcome Step */}
          {step === 'welcome' && (
            <div className="p-8 text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-[#00A884]/15 flex items-center justify-center">
                <div className="w-14 h-14 rounded-2xl bg-[#25D366] flex items-center justify-center text-white shadow-md">
                  <Phone className="w-7 h-7" />
                </div>
              </div>
              <h1 className="text-2xl font-bold mb-2">Welcome to WhatsApp Pro</h1>
              <p className="text-sm text-[#667781] dark:text-[#8696a0] mb-6 leading-relaxed">
                Fast, private, end-to-end encrypted messaging, HD voice & video calls, communities, and status updates across all your devices.
              </p>

              <div className="grid grid-cols-3 gap-3 mb-8 text-left">
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-100 dark:border-[#2a3942]">
                  <Shield className="w-5 h-5 text-[#00A884] mb-1.5" />
                  <p className="text-xs font-semibold">Signal E2EE</p>
                  <p className="text-[11px] text-[#667781] dark:text-[#8696a0]">Private keys stay on your device</p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-100 dark:border-[#2a3942]">
                  <Sparkles className="w-5 h-5 text-[#00A884] mb-1.5" />
                  <p className="text-xs font-semibold">Rich Media</p>
                  <p className="text-[11px] text-[#667781] dark:text-[#8696a0]">Voice notes, polls, stories & docs</p>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#111b21] border border-gray-100 dark:border-[#2a3942]">
                  <Lock className="w-5 h-5 text-[#00A884] mb-1.5" />
                  <p className="text-xs font-semibold">2FA Protected</p>
                  <p className="text-[11px] text-[#667781] dark:text-[#8696a0]">Optional 6-digit security PIN</p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setStep('phone');
                  }}
                  className="w-full py-3 rounded-xl bg-[#00A884] hover:bg-[#008f6f] text-white font-semibold text-sm flex items-center justify-center gap-2 transition shadow-sm"
                >
                  Agree and Continue <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setStep('phone');
                  }}
                  className="w-full py-2.5 rounded-xl border border-gray-200 dark:border-[#2a3942] hover:bg-gray-50 dark:hover:bg-[#2a3942] text-sm font-medium transition"
                >
                  Create a New Account
                </button>
              </div>
            </div>
          )}

          {/* Phone Input Step */}
          {step === 'phone' && (
            <form onSubmit={handleSendOtp} className="p-8">
              <button
                type="button"
                onClick={() => setStep('welcome')}
                className="flex items-center gap-1.5 text-xs text-[#667781] hover:text-[#111b21] dark:hover:text-white mb-4"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>

              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold">
                    {mode === 'register' ? 'Register your phone' : 'Enter your phone number'}
                  </h2>
                  <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-1">
                    WhatsApp Pro will send an SMS verification code to verify your number.
                  </p>
                </div>
              </div>

              {/* Mode toggle tabs */}
              <div className="grid grid-cols-2 p-1 rounded-xl bg-gray-100 dark:bg-[#111b21] mb-5">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className={`py-2 rounded-lg text-xs font-semibold transition ${
                    mode === 'login'
                      ? 'bg-white dark:bg-[#202c33] text-[#00A884] shadow-sm'
                      : 'text-[#667781] dark:text-[#8696a0]'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => setMode('register')}
                  className={`py-2 rounded-lg text-xs font-semibold transition ${
                    mode === 'register'
                      ? 'bg-white dark:bg-[#202c33] text-[#00A884] shadow-sm'
                      : 'text-[#667781] dark:text-[#8696a0]'
                  }`}
                >
                  Create Account
                </button>
              </div>

              {/* Country Code Selector */}
              <div className="relative mb-4">
                <label className="block text-xs font-medium text-[#667781] dark:text-[#8696a0] mb-1.5">
                  Country
                </label>
                <button
                  type="button"
                  onClick={() => setCountryDropdownOpen((o) => !o)}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm"
                >
                  <span className="flex items-center gap-2.5">
                    <span className="text-lg">{selectedCountry.flag}</span>
                    <span className="font-medium">{selectedCountry.name}</span>
                    <span className="text-[#667781]">({selectedCountry.dialCode})</span>
                  </span>
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                </button>

                {countryDropdownOpen && (
                  <div className="absolute left-0 right-0 mt-1 bg-white dark:bg-[#202c33] border border-gray-200 dark:border-[#2a3942] rounded-xl shadow-xl z-20 overflow-hidden">
                    <div className="p-2 border-b border-gray-100 dark:border-[#2a3942] flex items-center gap-2">
                      <Search className="w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={countrySearch}
                        onChange={(e) => setCountrySearch(e.target.value)}
                        placeholder="Search country or dial code..."
                        className="w-full bg-transparent text-sm focus:outline-none"
                        autoFocus
                      />
                    </div>
                    <div className="max-h-52 overflow-y-auto">
                      {filteredCountries.map((c) => (
                        <button
                          key={`${c.code}-${c.dialCode}`}
                          type="button"
                          onClick={() => {
                            setSelectedCountry(c);
                            setCountryDropdownOpen(false);
                            setCountrySearch('');
                          }}
                          className="w-full flex items-center justify-between px-3.5 py-2 text-sm hover:bg-gray-100 dark:hover:bg-[#2a3942] text-left"
                        >
                          <span className="flex items-center gap-2.5">
                            <span>{c.flag}</span>
                            <span>{c.name}</span>
                          </span>
                          <span className="text-xs text-[#667781] font-mono">{c.dialCode}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Phone Input */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-[#667781] dark:text-[#8696a0] mb-1.5">
                  Phone Number
                </label>
                <div className="flex items-center gap-2">
                  <div className="px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-100 dark:bg-[#111b21] text-sm font-mono font-semibold">
                    {selectedCountry.dialCode}
                  </div>
                  <input
                    type="tel"
                    value={phoneDigits}
                    onChange={(e) => setPhoneDigits(e.target.value.replace(/[^\d\s-]/g, ''))}
                    placeholder="555 019 2834"
                    className="flex-1 px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm focus:outline-none focus:ring-2 focus:ring-[#00A884]"
                    required
                  />
                </div>
              </div>

              {mode === 'register' && (
                <div className="space-y-4 mb-5">
                  <div>
                    <label className="block text-xs font-medium text-[#667781] dark:text-[#8696a0] mb-1.5">
                      Display Name *
                    </label>
                    <input
                      type="text"
                      value={regDisplayName}
                      onChange={(e) => setRegDisplayName(e.target.value)}
                      placeholder="Alex Mercer"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm focus:outline-none focus:ring-2 focus:ring-[#00A884]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#667781] dark:text-[#8696a0] mb-1.5">
                      Username (optional)
                    </label>
                    <input
                      type="text"
                      value={regUsername}
                      onChange={(e) => setRegUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                      placeholder="alex_mercer"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm focus:outline-none focus:ring-2 focus:ring-[#00A884]"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 rounded-xl bg-[#00A884] hover:bg-[#008f6f] text-white font-semibold text-sm transition disabled:opacity-50"
              >
                {isLoading ? 'Sending Verification Code...' : 'Send Verification Code'}
              </button>
            </form>
          )}

          {/* OTP Verification Step */}
          {step === 'otp' && (
            <form onSubmit={handleVerifyOtp} className="p-8 text-center">
              <button
                type="button"
                onClick={() => setStep('phone')}
                className="flex items-center gap-1.5 text-xs text-[#667781] hover:text-[#111b21] dark:hover:text-white mb-4"
              >
                <ArrowLeft className="w-4 h-4" /> Change number
              </button>

              <h2 className="text-xl font-bold mb-1">Verify {fullPhoneNumber}</h2>
              <p className="text-xs text-[#667781] dark:text-[#8696a0] mb-6">
                Enter the 6-digit SMS code sent to your phone.
              </p>

              {devOtp && (
                <div className="mb-5 px-3.5 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between gap-3">
                  <div className="text-left">
                    <span className="font-medium block">Dev Mode OTP (SMS not configured):</span>
                    <span className="font-mono font-bold text-sm tracking-widest text-[#00A884] dark:text-[#25D366]">
                      {devOtp}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleFillDevOtp}
                    className="px-3 py-1.5 rounded-lg bg-[#00A884] hover:bg-[#008f6f] text-white font-semibold text-xs shrink-0 transition"
                  >
                    Fill OTP
                  </button>
                </div>
              )}

              <div className="flex justify-center gap-2.5 mb-6" onPaste={handleOtpPaste}>
                {otpDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      otpRefs.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    className="w-11 h-13 py-2.5 text-center text-xl font-bold rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] focus:outline-none focus:ring-2 focus:ring-[#00A884]"
                  />
                ))}
              </div>

              <button
                type="submit"
                disabled={isLoading || otpDigits.join('').length !== 6}
                className="w-full py-3 rounded-xl bg-[#00A884] hover:bg-[#008f6f] text-white font-semibold text-sm transition disabled:opacity-50 mb-4"
              >
                {isLoading ? 'Verifying...' : 'Verify & Continue'}
              </button>

              <div className="text-xs text-[#667781] dark:text-[#8696a0]">
                {countdown > 0 ? (
                  <span>Resend code in {countdown}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleResendOtp()}
                    className="text-[#00A884] font-semibold hover:underline"
                  >
                    Resend SMS Code
                  </button>
                )}
              </div>
            </form>
          )}

          {/* 2FA Challenge Step */}
          {step === 'two_factor_challenge' && (
            <form onSubmit={handleVerify2FA} className="p-8 text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-[#00A884]/15 text-[#00A884] flex items-center justify-center">
                <Lock className="w-7 h-7" />
              </div>
              <h2 className="text-xl font-bold mb-1">Two-Step Verification</h2>
              <p className="text-xs text-[#667781] dark:text-[#8696a0] mb-6">
                This account is protected with a 6-digit Two-Step Verification PIN.
              </p>

              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••••"
                className="w-full text-center tracking-[0.5em] text-2xl font-mono py-3 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] focus:outline-none focus:ring-2 focus:ring-[#00A884] mb-5"
                autoFocus
              />

              <button
                type="submit"
                disabled={isLoading || pin.length !== 6}
                className="w-full py-3 rounded-xl bg-[#00A884] hover:bg-[#008f6f] text-white font-semibold text-sm transition disabled:opacity-50"
              >
                {isLoading ? 'Checking PIN...' : 'Unlock Account'}
              </button>
            </form>
          )}

          {/* Profile Setup Step */}
          {step === 'profile' && (
            <form onSubmit={handleSaveProfile} className="p-8">
              <h2 className="text-xl font-bold text-center mb-1">Profile Info</h2>
              <p className="text-xs text-[#667781] dark:text-[#8696a0] text-center mb-6">
                Please provide your name and an optional profile photo.
              </p>

              <div className="flex justify-center mb-6">
                <label className="relative cursor-pointer group">
                  <Avatar src={avatarUrl} name={displayName || 'U'} size="xl" />
                  <span className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-[#00A884] text-white flex items-center justify-center shadow-md group-hover:scale-105 transition">
                    <Camera className="w-4 h-4" />
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                    disabled={uploadingAvatar}
                  />
                </label>
              </div>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-medium text-[#667781] dark:text-[#8696a0] mb-1">
                    Display Name *
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm focus:outline-none focus:ring-2 focus:ring-[#00A884]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#667781] dark:text-[#8696a0] mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                    placeholder="unique_username"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm focus:outline-none focus:ring-2 focus:ring-[#00A884]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#667781] dark:text-[#8696a0] mb-1">
                    About
                  </label>
                  <input
                    type="text"
                    value={about}
                    onChange={(e) => setAbout(e.target.value)}
                    maxLength={140}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm focus:outline-none focus:ring-2 focus:ring-[#00A884]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || uploadingAvatar}
                className="w-full py-3 rounded-xl bg-[#00A884] hover:bg-[#008f6f] text-white font-semibold text-sm transition disabled:opacity-50"
              >
                {isLoading ? 'Saving...' : 'Save & Continue'}
              </button>
            </form>
          )}

          {/* Optional Two-Step Verification Setup */}
          {step === 'two_factor_setup' && (
            <form onSubmit={handleSetup2FA} className="p-8">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[#00A884]/15 text-[#00A884] flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-center mb-1">Add Two-Step Verification</h2>
              <p className="text-xs text-[#667781] dark:text-[#8696a0] text-center mb-6">
                Protect your account with a 6-digit PIN when registering your phone number again.
              </p>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-medium text-[#667781] dark:text-[#8696a0] mb-1">
                    6-Digit PIN
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••••"
                    className="w-full text-center tracking-[0.4em] font-mono py-2.5 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-lg focus:outline-none focus:ring-2 focus:ring-[#00A884]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#667781] dark:text-[#8696a0] mb-1">
                    Confirm PIN
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••••"
                    className="w-full text-center tracking-[0.4em] font-mono py-2.5 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-lg focus:outline-none focus:ring-2 focus:ring-[#00A884]"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                <button
                  type="submit"
                  disabled={isLoading || pin.length !== 6}
                  className="w-full py-3 rounded-xl bg-[#00A884] hover:bg-[#008f6f] text-white font-semibold text-sm transition disabled:opacity-50"
                >
                  Enable PIN & Start Messaging
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/', { replace: true })}
                  className="w-full py-2.5 rounded-xl text-xs font-medium text-[#667781] hover:text-[#111b21] dark:hover:text-white"
                >
                  Skip for Now
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <ImageCropModal
        file={cropFile}
        shape="circle"
        title="Crop Profile Photo"
        onCancel={() => setCropFile(null)}
        onConfirm={(blob) => void handleAvatarCropConfirm(blob)}
      />
    </div>
  );
};
