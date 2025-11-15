interface LoadingSpinnerProps {
  message?: string;
  fullscreen?: boolean;
}

export const LoadingSpinner = ({
  message = "Processing your request...",
  fullscreen = false,
}: LoadingSpinnerProps) => {
  const content = (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-orange-200 border-t-orange-600"></div>
        <img
          src="/public/logo.svg"
          alt="Loading"
          className="absolute inset-0 m-auto h-6 w-6"
        />
      </div>
      {message && (
        <p className="font-semibold text-slate-700 dark:text-slate-300 animate-pulse">
          {message}
        </p>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 fade-in">
        <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-2xl border animate-in">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center p-8 animate-in">
      {content}
    </div>
  );
};
