const App = () => (
  <ToastProvider>
    <MyFeedsPage />
  </ToastProvider>
);

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
