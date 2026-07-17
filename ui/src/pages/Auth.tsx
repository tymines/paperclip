import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { getRememberedInvitePath } from "../lib/invite-memory";
import { Button } from "@/components/ui/button";
import { AsciiArtAnimation } from "@/components/AsciiArtAnimation";
import { Sparkles } from "lucide-react";

type Step = "request_code" | "enter_code";

export function AuthPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<Step>("request_code");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const nextPath = useMemo(
    () => searchParams.get("next") || getRememberedInvitePath() || "/",
    [searchParams],
  );
  const { data: session, isLoading: isSessionLoading } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  useEffect(() => {
    if (session) {
      navigate(nextPath, { replace: true });
    }
  }, [session, navigate, nextPath]);

  const sendCode = useMutation({
    mutationFn: async () => {
      await authApi.sendSignInOtp({ email: email.trim() });
    },
    onSuccess: () => {
      setError(null);
      setNotice(`We sent a one-time code to ${email.trim()}. Enter it below.`);
      setStep("enter_code");
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not send the login code.");
    },
  });

  const verifyCode = useMutation({
    mutationFn: async () => {
      await authApi.signInWithOtp({ email: email.trim(), otp: otp.trim() });
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      navigate(nextPath, { replace: true });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "That code didn't work. Try again.");
    },
  });

  const canSend = email.trim().length > 0 && !sendCode.isPending;
  const canVerify = otp.trim().length > 0 && !verifyCode.isPending;

  if (isSessionLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex bg-background">
      {/* Left half — form */}
      <div className="w-full md:w-1/2 flex flex-col overflow-y-auto">
        <div className="w-full max-w-md mx-auto my-auto px-8 py-12">
          <div className="flex items-center gap-2 mb-8">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Paperclip</span>
          </div>

          <h1 className="text-xl font-semibold">Sign in to Paperclip</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {step === "request_code"
              ? "Enter your email and we'll send you a one-time sign-in code."
              : "Enter the one-time code we emailed you."}
          </p>

          {step === "request_code" ? (
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!canSend) {
                  setError("Enter your email address.");
                  return;
                }
                sendCode.mutate();
              }}
            >
              <div>
                <label htmlFor="email" className="text-xs text-muted-foreground mb-1 block">Email</label>
                <input
                  id="email"
                  name="email"
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  autoFocus
                />
              </div>
              {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button
                type="submit"
                disabled={sendCode.isPending}
                aria-disabled={!canSend}
                className={`w-full ${!canSend ? "opacity-50" : ""}`}
              >
                {sendCode.isPending ? "Sending…" : "Email me a code"}
              </Button>
            </form>
          ) : (
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!canVerify) {
                  setError("Enter the code from your email.");
                  return;
                }
                verifyCode.mutate();
              }}
            >
              <div>
                <label htmlFor="email-readonly" className="text-xs text-muted-foreground mb-1 block">Email</label>
                <input
                  id="email-readonly"
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-muted-foreground outline-none"
                  type="email"
                  value={email}
                  readOnly
                />
              </div>
              <div>
                <label htmlFor="otp" className="text-xs text-muted-foreground mb-1 block">One-time code</label>
                <input
                  id="otp"
                  name="otp"
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm tracking-widest outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                  autoFocus
                  placeholder="123456"
                />
              </div>
              {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button
                type="submit"
                disabled={verifyCode.isPending}
                aria-disabled={!canVerify}
                className={`w-full ${!canVerify ? "opacity-50" : ""}`}
              >
                {verifyCode.isPending ? "Verifying…" : "Sign In"}
              </Button>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <button
                  type="button"
                  className="font-medium text-foreground underline underline-offset-2"
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    setOtp("");
                    setStep("request_code");
                  }}
                >
                  Use a different email
                </button>
                <button
                  type="button"
                  className="font-medium text-foreground underline underline-offset-2 disabled:opacity-50"
                  disabled={sendCode.isPending}
                  onClick={() => sendCode.mutate()}
                >
                  {sendCode.isPending ? "Sending…" : "Resend code"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Right half — ASCII art animation (hidden on mobile) */}
      <div className="hidden md:block w-1/2 overflow-hidden">
        <AsciiArtAnimation />
      </div>
    </div>
  );
}
