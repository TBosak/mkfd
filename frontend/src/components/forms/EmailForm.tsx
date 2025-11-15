import {
  UseFormRegister,
  Control,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";
import { FeedFormData } from "@/types/feed";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FolderOpen, Mail, Lock } from "lucide-react";
import { useState } from "react";

interface EmailFormProps {
  register: UseFormRegister<FeedFormData>;
  control: Control<FeedFormData>;
  setValue: UseFormSetValue<FeedFormData>;
  watch: UseFormWatch<FeedFormData>;
}

export const EmailForm = ({ register, setValue, watch }: EmailFormProps) => {
  const [folders, setFolders] = useState<string[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);

  const emailHost = watch("emailHost");
  const emailPort = watch("emailPort");
  const emailUsername = watch("emailUsername");
  const emailPassword = watch("emailPassword");
  const emailFolder = watch("emailFolder");

  const handleFetchFolders = async () => {
    if (!emailHost || !emailPort || !emailUsername || !emailPassword) {
      alert("Please fill in IMAP server details first.");
      return;
    }

    setLoadingFolders(true);
    try {
      const response = await fetch("/imap/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: emailHost,
          port: Number(emailPort),
          user: emailUsername,
          password: emailPassword,
        }),
      });

      if (!response.ok) throw new Error("Failed to fetch folders");

      const data = await response.json();
      setFolders(data.folders || []);
    } catch (error) {
      console.error("Error:", error);
      alert("Failed to fetch folders. Check your credentials.");
    } finally {
      setLoadingFolders(false);
    }
  };

  return (
    <div className="space-y-6 mt-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <Mail className="h-5 w-5" />
        Email Configuration
      </h3>

      {/* IMAP Server */}
      <div className="space-y-2">
        <Label htmlFor="emailHost">IMAP Server</Label>
        <Input
          id="emailHost"
          {...register("emailHost")}
          placeholder="imap.gmail.com"
        />
      </div>

      {/* IMAP Port */}
      <div className="space-y-2">
        <Label htmlFor="emailPort">IMAP Port</Label>
        <Input
          id="emailPort"
          type="number"
          {...register("emailPort")}
          placeholder="993"
        />
      </div>

      {/* Username */}
      <div className="space-y-2">
        <Label htmlFor="emailUsername">Username</Label>
        <Input
          id="emailUsername"
          {...register("emailUsername")}
          placeholder="your-email@example.com"
        />
      </div>

      {/* Password */}
      <div className="space-y-2">
        <Label htmlFor="emailPassword" className="flex items-center gap-2">
          <Lock className="h-4 w-4" />
          Password
        </Label>
        <Input
          id="emailPassword"
          type="password"
          {...register("emailPassword")}
          placeholder="••••••••"
        />
      </div>

      {/* Folder Selection */}
      <div className="space-y-2">
        <Label htmlFor="emailFolder">Folder</Label>
        <div className="flex gap-2">
          <Select
            value={emailFolder || ""}
            onValueChange={(value) => setValue("emailFolder", value)}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select folder" />
            </SelectTrigger>
            <SelectContent>
              {folders.length === 0 ? (
                <SelectItem value="INBOX">INBOX</SelectItem>
              ) : (
                folders.map((folder) => (
                  <SelectItem key={folder} value={folder}>
                    {folder}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            onClick={handleFetchFolders}
            disabled={loadingFolders}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            {loadingFolders ? "Loading..." : "Load Folders"}
          </Button>
        </div>
      </div>

      {/* Max Emails */}
      <div className="space-y-2">
        <Label htmlFor="emailCount">Max Emails in Feed</Label>
        <Input
          id="emailCount"
          type="number"
          {...register("emailCount")}
          min="1"
          max="1000"
          defaultValue="10"
        />
      </div>
    </div>
  );
};
