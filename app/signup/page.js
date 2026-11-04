import { Suspense } from "react";
import { AuthForm } from "@/components/features/auth/AuthForm";

export const metadata = { title: "Sign up" };

async function SignupFormContainer({ searchParams }) {
  const params = await searchParams;
  const errorParam = params?.error;
  let initialError = "";

  if (errorParam) {
    if (errorParam === "oauth_failed" || errorParam === "auth_callback_failed") {
      initialError = "Google authentication failed or was cancelled. Please try again.";
    } else {
      initialError = decodeURIComponent(errorParam);
    }
  }

  return <AuthForm mode="signup" initialError={initialError} />;
}

export default function Page({ searchParams }) {
  return (
    <div className="flex justify-center px-6 py-16">
      <Suspense fallback={<AuthForm mode="signup" initialError="" />}>
        <SignupFormContainer searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
