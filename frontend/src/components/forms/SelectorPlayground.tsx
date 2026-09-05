import { useState, useEffect, useRef } from "react";
import { UseFormSetValue } from "react-hook-form";
import { FeedFormData, FlareSolverrConfig } from "@/types/feed";
import { Button } from "@/components/ui/button";
import { Wand2 } from "lucide-react";

interface SelectorPlaygroundProps {
	feedUrl?: string;
	setValue: UseFormSetValue<FeedFormData>;
	flaresolverr?: FlareSolverrConfig;
}

export const SelectorPlayground = ({
	feedUrl,
	setValue,
}: SelectorPlaygroundProps) => {
	const [isPlaygroundOpen, setIsPlaygroundOpen] = useState(false);
	const [showSelectorActions, setShowSelectorActions] = useState(false);
	const [currentSelector, setCurrentSelector] = useState<string | null>(null);
	// Regenerated every time the playground opens, so a nonce captured from a
	// previous session cannot drive a later one.
	const [sessionNonce, setSessionNonce] = useState<string>("");
	const iframeRef = useRef<HTMLIFrameElement | null>(null);

	const buildProxyUrl = () => {
		const params = new URLSearchParams({ url: feedUrl || "" });
		if (sessionNonce) params.set("nonce", sessionNonce);
		// FlareSolverr configuration deliberately does not travel in this URL:
		// it would leak an internal service address into browser history,
		// referrer headers and logs, and let any caller redirect the server.
		return `/proxy?${params.toString()}`;
	};

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			// Bound to the exact window we created. The iframe is opaque-origin,
			// so event.origin is "null" and cannot be compared usefully; identity
			// of the source window is what actually distinguishes our playground
			// from any other frame or popup on the page.
			if (event.source !== iframeRef.current?.contentWindow) return;
			const data = event.data as { type?: unknown; selector?: unknown; nonce?: unknown } | null;
			if (data?.type !== "selectorUpdated") return;
			// The nonce ties the message to this playground session, so one
			// captured from an earlier session is refused.
			if (typeof data.nonce !== "string" || !sessionNonce || data.nonce !== sessionNonce) return;
			if (typeof data.selector !== "string") return;
			const selector = data.selector.trim();
			if (!selector || selector.length > 512) return;
			setCurrentSelector(selector);
		};
		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [sessionNonce]);

	const handleOpenPlayground = () => {
		if (!feedUrl) {
			alert("Please enter a target URL on the Basic tab first.");
			return;
		}
		setSessionNonce(crypto.randomUUID().replace(/-/g, ""));
		setCurrentSelector(null);
		setIsPlaygroundOpen(true);
		setShowSelectorActions(true);
	};

	const handleClosePlayground = () => {
		setIsPlaygroundOpen(false);
		setShowSelectorActions(false);
		setSessionNonce("");
	};

	const handleSetSelector = (fieldName: string) => {
		if (!currentSelector) {
			alert("No selector chosen yet!");
			return;
		}
		setValue(fieldName as any, currentSelector);
		alert(`Set ${fieldName} to: ${currentSelector}`);
	};

	const selectorFields = [
		{ field: "itemSelector", label: "Item" },
		{ field: "titleSelector", label: "Title" },
		{ field: "descriptionSelector", label: "Description" },
		{ field: "linkSelector", label: "Link" },
		{ field: "enclosureSelector", label: "Enclosure" },
		{ field: "authorSelector", label: "Author" },
		{ field: "dateSelector", label: "Date" },
		{ field: "contentEncodedSelector", label: "Content Encoded" },
		{ field: "summarySelector", label: "Summary" },
		{ field: "guidSelector", label: "GUID" },
		{ field: "categoriesSelector", label: "Item Categories" },
		{ field: "contributorsSelector", label: "Contributors" },
		{ field: "latSelector", label: "Latitude" },
		{ field: "longSelector", label: "Longitude" },
		{ field: "sourceUrlSelector", label: "Source URL" },
		{ field: "sourceTitleSelector", label: "Source Title" },
	];

	return (
		<>
			{/* Inline trigger button — lives in the selectors tab header row */}
			<Button
				type="button"
				variant="outline"
				onClick={handleOpenPlayground}
				size="sm"
				disabled={!feedUrl}
				title={
					feedUrl
						? "Open selector playground"
						: "Enter a target URL on the Basic tab first"
				}
			>
				<Wand2 className="mr-2 h-4 w-4" />
				Selector Playground
			</Button>

			{/* Floating selector field sidebar — only shown while playground is open */}
			{showSelectorActions && (
				<div
					className="fixed top-6 left-0 z-[10000] bg-white rounded-r-lg border-2 border-l-0 border-gray-300 shadow-lg p-2 flex flex-col gap-2 w-44 max-h-[80vh] overflow-y-auto"
					style={{ opacity: 0.98 }}
				>
					<div className="flex flex-col gap-1">
						{selectorFields.map(({ field, label }) => (
							<Button
								key={field}
								type="button"
								variant="outline"
								size="sm"
								onClick={() => handleSetSelector(field)}
								className="w-full text-xs whitespace-nowrap overflow-hidden text-ellipsis"
							>
								{label}
							</Button>
						))}
						<Button
							type="button"
							size="sm"
							onClick={handleClosePlayground}
							className="w-full"
						>
							Close
						</Button>
					</div>
				</div>
			)}

			{/* Fullscreen iframe overlay */}
			{isPlaygroundOpen && (
				<>
					<button
						type="button"
						aria-label="Close selector playground"
						className="fixed inset-0 z-[9999] border-0 bg-black/50 p-0"
						onClick={handleClosePlayground}
					/>
					<div className="pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center p-4">
						<div className="pointer-events-auto relative w-[90%] h-[90%] bg-white rounded-lg overflow-hidden shadow-xl">
							<iframe
								src={buildProxyUrl()}
								className="w-full h-full border-0"
								ref={iframeRef}
								// Opaque origin on purpose. Granting same-origin here would let
								// any script in the proxied page act as the app: read storage
								// and call authenticated APIs with the operator's session.
								sandbox="allow-scripts"
								title="Selector Playground"
							/>
						</div>
					</div>
				</>
			)}
		</>
	);
};
