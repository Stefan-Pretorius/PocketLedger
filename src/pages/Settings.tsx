import { useState, useRef, useEffect } from "react";
import { useStore } from "../store";
import { formatCurrency } from "../utils";
import { Colors } from "../theme";
import {
  Card, Button, Input, Modal, EmptyState, SectionHeader, Confirm,
} from "../components/ui";
import { PageHeader } from "../components/Layout";
import {
  Download, Upload, Trash2, Plus, Settings as SettingsIcon,
  AlertTriangle, Landmark, Edit2, FolderOpen, Cloud, Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Account, AccountType } from "../types";
import { getDirHandle, setDirHandle, removeDirHandle, autoSaveToDir, pickBackupFolder, getImportDirHandle, setImportDirHandle, removeImportDirHandle, pickImportFolder } from "../backup";
import { getClientId, setClientId, getStoredToken, getLastSyncTime, getConnectedEmail, authenticate, uploadToDrive, downloadFromDrive, downloadFileContent, revokeAccess, getStatementFolderId, setStatementFolderId, removeStatementFolderId, listStatementFiles } from "../googledrive";

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function BankRuleModal({
  visible, onClose,
}: {
  visible: boolean; onClose: () => void;
}) {
  const { createBankRule, goals, categories, activeBudgetId, accounts } = useStore();
  const [keyword, setKeyword] = useState("");
  const [routeTo, setRouteTo] = useState<"category" | "goal" | "goalWithdrawal" | "skip">("category");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [goalId, setGoalId] = useState<number | null>(null);
  const [transferToAccountId, setTransferToAccountId] = useState<number | null>(null);

  // Unique category names across all budgets, plus highlight the current budget's ones
  const budgetCats = categories.filter(c => c.budgetId === activeBudgetId);
  const allCats = categories;
  const uniqueCats = Array.from(new Map(allCats.map(c => [c.name.toLowerCase(), c])).values());

  const save = () => {
    if (!keyword.trim()) { toast.error("Keyword required"); return; }
    if (routeTo === "skip") {
      createBankRule({ keyword: keyword.trim(), routeTo: "skip", transferToAccountId: transferToAccountId ?? undefined });
    } else if (routeTo === "category") {
      const cat = uniqueCats.find(c => c.id === categoryId);
      if (!cat) { toast.error("Select a category"); return; }
      createBankRule({ keyword: keyword.trim(), routeTo: "category", categoryName: cat.name });
    } else if (routeTo === "goalWithdrawal") {
      if (goalId == null) { toast.error("Select a goal"); return; }
      createBankRule({ keyword: keyword.trim(), routeTo: "goalWithdrawal", goalId });
    } else {
      if (goalId == null) { toast.error("Select a goal"); return; }
      createBankRule({ keyword: keyword.trim(), routeTo: "goal", goalId });
    }
    toast.success("Mapping rule added");
    setKeyword(""); setCategoryId(null); setGoalId(null); setTransferToAccountId(null);
    onClose();
  };

  return (
    <Modal visible={visible} onClose={onClose} title="Add Bank Mapping Rule">
      <div className="space-y-4">
        <Input
          label="Transaction Keyword"
          value={keyword}
          onChange={setKeyword}
          placeholder="e.g. ROUND UP TO SAVINGS"
          autoFocus
        />
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Route To</label>
          <div className="flex gap-2">
            {(["category", "goal", "goalWithdrawal", "skip"] as const).map(t => (
              <button key={t} onClick={() => { setRouteTo(t); if (t !== "skip") setTransferToAccountId(null); }}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium capitalize transition-colors",
                  routeTo === t ? (t === "skip" ? "bg-destructive text-destructive-foreground" : t === "goalWithdrawal" ? "bg-chart-2 text-white" : "bg-primary text-primary-foreground") : "bg-muted text-foreground hover:bg-muted/80",
                )}>
                {t === "goal" ? "⭐ Goal" : t === "goalWithdrawal" ? "🔻 Withdraw" : t === "skip" ? "⏭ Skip" : t}
              </button>
            ))}
          </div>
        </div>
        {routeTo === "skip" ? (
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-destructive/5 border border-destructive/20">
              <p className="text-xs text-destructive font-medium">
                Transactions matching this keyword will be automatically skipped during import. Use this for transfers between your own accounts.
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground block mb-2">Transfer to Account (optional)</label>
              {accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No accounts yet — add one in the Accounts section below.</p>
              ) : (
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto scrollbar-thin">
                  {accounts.map(a => (
                    <button key={a.id} onClick={() => setTransferToAccountId(transferToAccountId === a.id ? null : a.id)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                        transferToAccountId === a.id
                          ? "bg-destructive text-destructive-foreground border-destructive"
                          : "border-border bg-card text-foreground hover:border-destructive/40",
                      )}>
                      <Landmark size={13} />
                      {a.name}
                    </button>
                  ))}
                </div>
              )}
              {transferToAccountId != null && (
                <p className="text-xs text-success mt-1">
                  A debit on the importing account and a credit on the destination account will be recorded.
                </p>
              )}
            </div>
          </div>
        ) : routeTo === "category" ? (
          <div>
            <label className="text-sm font-medium text-muted-foreground block mb-2">Category</label>
            {uniqueCats.length === 0 ? (
              <p className="text-sm text-muted-foreground">No categories yet — add some in the Budget page first.</p>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto scrollbar-thin">
                {[...uniqueCats].sort((a, b) => a.name.localeCompare(b.name)).map(c => {
                  const isCurrentBudget = budgetCats.some(bc => bc.id === c.id);
                  return (
                    <button key={c.id} onClick={() => setCategoryId(c.id)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                        categoryId === c.id
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border bg-card text-foreground hover:border-primary/40",
                      )}>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                      {c.name}
                      {!isCurrentBudget && <span className="text-[9px] opacity-60 ml-0.5">(other)</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div>
            <label className="text-sm font-medium text-muted-foreground block mb-2">Goal</label>
            {goals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No goals yet — create one in the Goals page first.</p>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto scrollbar-thin">
                {goals.map(g => (
                  <button key={g.id} onClick={() => setGoalId(g.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                      goalId === g.id
                        ? routeTo === "goalWithdrawal" ? "bg-chart-2 text-white border-chart-2" : "bg-primary text-primary-foreground border-primary"
                        : "border-border bg-card text-foreground hover:border-primary/40",
                    )}>
                    <span className="w-2 h-2 rounded-full flex-shrink-0 inline-block" style={{ backgroundColor: g.color }} />
                    <span className="ml-1">{routeTo === "goalWithdrawal" ? "🔻" : "⭐"} {g.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {routeTo === "skip"
            ? "Transactions containing this keyword will be automatically skipped and not imported."
            : routeTo === "category"
            ? "Transactions containing this keyword will be automatically assigned as expenses to the matching category."
            : routeTo === "goalWithdrawal"
            ? "Transactions containing this keyword will withdraw from the selected savings goal."
            : "Transactions containing this keyword will contribute to the selected savings goal (no budget impact)."}
        </p>
        <div className="flex gap-2">
          <Button label="Cancel" onClick={onClose} variant="secondary" fullWidth />
          <Button label="Add Rule" onClick={save} variant="primary" fullWidth disabled={routeTo !== "skip" && routeTo === "category" && categoryId == null} />
        </div>
      </div>
    </Modal>
  );
}

function AccountModal({
  visible, onClose, initial,
}: {
  visible: boolean;
  onClose: () => void;
  initial?: Account;
}) {
  const { createAccount, updateAccount } = useStore();
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<AccountType>(initial?.type ?? "individual");
  const [balance, setBalance] = useState(initial?.balance != null ? String(initial.balance) : "");
  const [accountNumber, setAccountNumber] = useState(initial?.accountNumber ?? "");

  const save = () => {
    if (!name.trim()) { toast.error("Account name is required"); return; }
    const payload = {
      name: name.trim(),
      type,
      balance: balance ? parseFloat(balance) : undefined,
      accountNumber: accountNumber.trim() || undefined,
    };
    if (initial) {
      updateAccount(initial.id, payload);
      toast.success("Account updated");
    } else {
      createAccount(payload);
      toast.success("Account added");
    }
    onClose();
  };

  return (
    <Modal visible={visible} onClose={onClose} title={initial ? "Edit Account" : "Add Account"}>
      <div className="space-y-4">
        <Input label="Account Name" value={name} onChange={setName} placeholder="e.g. ANZ Personal, Joint Savings" autoFocus />
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Account Type</label>
          <div className="flex gap-2">
            {(["individual", "joint"] as const).map(t => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-colors capitalize",
                  type === t ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <Input label="Current Balance (optional)" value={balance} onChange={setBalance} type="number" prefix="$" placeholder="0.00" />
        <Input label="Account/Bank Number (optional)" value={accountNumber} onChange={setAccountNumber} placeholder="e.g. 12345678 or BSB 012-345 123456" />
        <div className="flex gap-2">
          <Button label="Cancel" onClick={onClose} variant="secondary" fullWidth />
          <Button label={initial ? "Save" : "Add Account"} onClick={save} variant="primary" fullWidth />
        </div>
      </div>
    </Modal>
  );
}

export function SettingsPage() {
  const { budgets, categories, expenses, goals, accounts, bankRules, deleteBankRule, deleteAccount, exportData, importData } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showBankRule, setShowBankRule] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmImport, setConfirmImport] = useState<string | null>(null);

  // Folder backup state
  const [folderReady, setFolderReady] = useState(false);
  const [folderTime, setFolderTime] = useState<number | null>(null);

  // Drive sync state
  const [driveClientId, setDriveClientId] = useState(getClientId() ?? "");
  const [driveToken, setDriveToken] = useState<string | null>(getStoredToken());
  const [driveEmail, setDriveEmail] = useState<string | null>(getConnectedEmail());
  const [driveLastSync, setDriveLastSync] = useState<number | null>(getLastSyncTime());
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [showDriveConfig, setShowDriveConfig] = useState(false);

  // Statement folder state
  const [stmtFolderId, setStmtFolderId] = useState(getStatementFolderId() ?? "");
  const [stmtFolderName, setStmtFolderName] = useState<string | null>(null);
  const [importFolderName, setImportFolderName] = useState<string | null>(null);
  const [importFolderReady, setImportFolderReady] = useState(false);

  useEffect(() => {
    getImportDirHandle().then(h => setImportFolderReady(!!h));
    // Fetch folder name if configured
    if (getStatementFolderId() && getStoredToken()) {
      listStatementFiles(getStatementFolderId()!, getClientId() ?? "").then(files => {
        // Just checking if folder is accessible; store name from first file's parent
        if (files.length > 0) setStmtFolderName(`${files.length} file${files.length !== 1 ? "s" : ""}`);
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    getDirHandle().then(h => setFolderReady(!!h));
    const t = localStorage.getItem("pocketledger_folderBackupTime");
    if (t) setFolderTime(parseInt(t, 10));
  }, []);

  // Poll for status updates every 10s
  useEffect(() => {
    const iv = setInterval(() => {
      setDriveToken(getStoredToken());
      setDriveEmail(getConnectedEmail());
      setDriveLastSync(getLastSyncTime());
      getDirHandle().then(h => setFolderReady(!!h));
      const t = localStorage.getItem("pocketledger_folderBackupTime");
      if (t) setFolderTime(parseInt(t, 10));
    }, 10000);
    return () => clearInterval(iv);
  }, []);

  const stats = [
    { label: "Accounts", value: accounts.length },
    { label: "Budgets", value: budgets.length },
    { label: "Categories", value: categories.length },
    { label: "Expenses", value: expenses.length },
  ];

  const handleExport = () => {
    const json = exportData();
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pocketledger-backup-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    toast.success("Backup downloaded");
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try { JSON.parse(text); } catch { toast.error("Invalid JSON file"); return; }
    setConfirmImport(text);
    e.target.value = "";
  };

  const doClearAll = () => {
    localStorage.removeItem("pocketledger_data");
    window.location.reload();
  };

  const handlePickFolder = async () => {
    const handle = await pickBackupFolder();
    if (handle) {
      setFolderReady(true);
      // Do an immediate backup
      const json = exportData();
      try { await autoSaveToDir(JSON.parse(json)); } catch {}
      localStorage.setItem("pocketledger_folderBackupTime", Date.now().toString());
      setFolderTime(Date.now());
      const name = handle.name;
      toast.success(`Auto-backup set to "${name}"`);
    } else {
      toast.error("Could not access folder. Try Chrome or Edge.");
    }
  };

  const handleRemoveFolder = async () => {
    await removeDirHandle();
    setFolderReady(false);
    setFolderTime(null);
    localStorage.removeItem("pocketledger_folderBackupTime");
    toast.success("Folder backup disabled");
  };

  const handleBackupNow = async () => {
    const json = exportData();
    const data = JSON.parse(json);
    try {
      await autoSaveToDir(data);
      localStorage.setItem("pocketledger_folderBackupTime", Date.now().toString());
      setFolderTime(Date.now());
      toast.success("Backup saved to folder");
    } catch {
      toast.error("Backup failed — check the folder is still accessible");
    }
  };

  const handleDriveConnect = async () => {
    if (!driveClientId.trim()) { toast.error("Enter your Google Client ID first"); return; }
    setDriveConnecting(true);
    try {
      setClientId(driveClientId.trim());
      const { token, email } = await authenticate(driveClientId.trim());
      setDriveToken(token);
      setDriveEmail(email);
      // Do an immediate backup
      const json = exportData();
      await uploadToDrive(json, driveClientId.trim());
      setDriveLastSync(Date.now());
      toast.success(`Connected as ${email}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setDriveConnecting(false);
    }
  };

  const handleDriveDisconnect = () => {
    revokeAccess();
    setDriveToken(null);
    setDriveEmail(null);
    setDriveLastSync(null);
    toast.success("Google Drive disconnected");
  };

  const handleDriveSyncNow = async () => {
    if (!driveClientId.trim()) return;
    const json = exportData();
    try {
      await uploadToDrive(json, driveClientId.trim());
      setDriveLastSync(Date.now());
      toast.success("Synced to Google Drive");
    } catch {
      toast.error("Sync failed");
    }
  };

  const handleRestoreFromDrive = async () => {
    if (!driveClientId.trim()) return;
    try {
      const text = await downloadFromDrive(driveClientId.trim());
      if (!text) { toast.error("No backup found in Drive"); return; }
      try { JSON.parse(text); } catch { toast.error("Invalid backup file"); return; }
      setConfirmImport(text);
    } catch {
      toast.error("Failed to fetch from Drive");
    }
  };

  const handleSetStmtFolder = () => {
    if (!stmtFolderId.trim()) { toast.error("Enter a folder ID"); return; }
    if (!getStoredToken()) { toast.error("Connect Google Drive sync first"); return; }
    setStatementFolderId(stmtFolderId.trim());
    // Verify access
    listStatementFiles(stmtFolderId.trim(), getClientId() ?? "").then(files => {
      if (files.length > 0) {
        setStmtFolderName(`${files.length} file${files.length !== 1 ? "s" : ""}`);
        toast.success(`Folder set — ${files.length} file${files.length !== 1 ? "s" : ""} found`);
      } else {
        setStmtFolderName("empty");
        toast.success("Folder set (empty)");
      }
    }).catch(() => {
      toast.error("Could not access folder — check the ID and try reconnecting Drive");
    });
  };

  const handleRemoveStmtFolder = () => {
    removeStatementFolderId();
    setStmtFolderName(null);
    setStmtFolderId("");
    toast.success("Statement folder removed");
  };

  const handlePickImportFolder = async () => {
    const result = await pickImportFolder();
    if (result) {
      setImportFolderName(result.name);
      setImportFolderReady(true);
      toast.success(`Import folder set: ${result.name}`);
    }
  };

  const handleRemoveImportFolder = async () => {
    await removeImportDirHandle();
    setImportFolderReady(false);
    setImportFolderName(null);
    toast.success("Import folder removed");
  };

  return (
    <div>
      <PageHeader title="Settings" />

      <div className="px-4 sm:px-6 space-y-6 pb-6">
        {/* App stats */}
        <div>
          <SectionHeader title="Data Summary" />
          <div className="grid grid-cols-2 gap-2">
            {stats.map(s => (
              <Card key={s.label} className="text-center py-3">
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
              </Card>
            ))}
          </div>
        </div>

        {/* Bank accounts */}
        <div>
          <SectionHeader
            title="Bank Accounts"
            action={{ label: "+ Add", onPress: () => { setEditAccount(null); setShowAccount(true); } }}
          />
          <Card className="mb-2 p-3 bg-primary/5 border-primary/20">
            <p className="text-xs text-muted-foreground">
              Track individual and joint accounts. Link income, expenses, and recurring bills to the account they use.
            </p>
          </Card>
          {accounts.length === 0 ? (
            <Card>
              <p className="text-sm text-muted-foreground text-center py-2">No accounts yet.</p>
              <Button label="Add Account" onClick={() => setShowAccount(true)} variant="secondary" fullWidth size="sm" icon={Plus} />
            </Card>
          ) : (
            <Card padding={false}>
              {accounts.map((acc, i) => (
                <div
                  key={acc.id}
                  className={cn("flex items-center gap-3 px-4 py-3", i < accounts.length - 1 && "border-b border-border")}
                >
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Landmark size={15} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{acc.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{acc.type} account{acc.balance != null ? <> · balance <span className="font-medium text-foreground">{formatCurrency(acc.balance)}</span></> : ""}</p>
                  </div>
                  <button
                    onClick={() => { setEditAccount(acc); setShowAccount(true); }}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                  >
                    <Edit2 size={13} />
                  </button>
                  <button
                    onClick={() => setConfirmDeleteAccount(acc.id)}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </Card>
          )}
        </div>

        {/* Backup & restore */}
        <div>
          <SectionHeader title="Backup & Restore" />
          <Card className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Download size={16} className="text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">Export Backup</p>
                <p className="text-xs text-muted-foreground mb-2">Download all your data as a JSON file.</p>
                <Button label="Download Backup" onClick={handleExport} variant="secondary" size="sm" icon={Download} />
              </div>
            </div>

            <div className="h-px bg-border" />

            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-warning/10 flex items-center justify-center flex-shrink-0">
                <Upload size={16} className="text-warning" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">Restore Backup</p>
                <p className="text-xs text-muted-foreground mb-2">
                  Import a previously exported JSON backup. This will replace all current data.
                </p>
                <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
                <Button label="Choose Backup File" onClick={() => fileRef.current?.click()} variant="secondary" size="sm" icon={Upload} />
              </div>
            </div>
          </Card>
        </div>

        {/* Auto-backup to folder */}
        <div>
          <SectionHeader title="Auto-Backup to Folder" />
          <Card>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-success/10 flex items-center justify-center flex-shrink-0">
                <FolderOpen size={16} className="text-success" />
              </div>
              <div className="flex-1 min-w-0">
                {folderReady ? (
                  <>
                    <p className="text-sm font-semibold text-foreground">✅ Auto-backup active</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Backup saved to your chosen folder
                      {folderTime && <> · last backup: {formatRelativeTime(folderTime)}</>}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <Button label="Backup Now" onClick={handleBackupNow} variant="secondary" size="sm" icon={Upload} />
                      <button
                        onClick={handleRemoveFolder}
                        className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
                      >
                        Disable
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-foreground">Set auto-backup folder</p>
                    <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                      Pick a folder on your computer. Your data will be auto-saved as <code className="text-xs bg-muted px-1 py-0.5 rounded">{'"pocketledger-backup.json"'}</code> after every change.
                      Works with Dropbox, OneDrive, or any synced folder.
                    </p>
                    <Button label="Choose Folder" onClick={handlePickFolder} variant="secondary" size="sm" icon={FolderOpen} />
                    <p className="text-xs text-muted-foreground mt-2">Chrome or Edge recommended. Firefox not supported.</p>
                  </>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* Google Drive Sync */}
        <div>
          <SectionHeader title="Google Drive Sync" />
          <Card>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Cloud size={16} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                {driveToken ? (
                  <>
                    <p className="text-sm font-semibold text-foreground">☁️ Connected {driveEmail && <span className="text-xs font-normal text-muted-foreground">({driveEmail})</span>}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Auto-syncing to Google Drive
                      {driveLastSync && <> · last sync: {formatRelativeTime(driveLastSync)}</>}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <Button label="Sync Now" onClick={handleDriveSyncNow} variant="secondary" size="sm" icon={Cloud} />
                      <button
                        onClick={() => setShowDriveConfig(true)}
                        className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Change Client ID
                      </button>
                      <button
                        onClick={handleDriveDisconnect}
                        className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
                      >
                        <Unlink size={12} className="inline mr-1" />
                        Disconnect
                      </button>
                    </div>
                    <button
                      onClick={handleRestoreFromDrive}
                      className="mt-2 text-xs text-primary hover:underline"
                    >
                      Restore from Drive backup
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-foreground">Connect to Google Drive</p>
                    <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                      Your data will be auto-synced to a private app folder in your Google Drive.
                      Requires a Google Cloud project with the Drive API enabled.
                    </p>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Google OAuth Client ID"
                        value={driveClientId}
                        onChange={setDriveClientId}
                        containerClassName="flex-1"
                      />
                      <Button label="Connect" onClick={handleDriveConnect} variant="primary" size="sm" icon={Cloud} loading={driveConnecting} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      <button onClick={() => setShowDriveConfig(true)} className="underline">How to set up Google Drive</button>
                    </p>
                  </>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* Drive setup instructions modal */}
        <Modal visible={showDriveConfig} onClose={() => setShowDriveConfig(false)} title="Google Drive Setup">
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>To use Google Drive sync, you need a <strong>Google Cloud project</strong> with the Drive API enabled:</p>
            <ol className="list-decimal pl-4 space-y-2">
              <li>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">Google Cloud Console</a></li>
              <li>Create a new project (or select existing)</li>
              <li>Enable the <strong>Google Drive API</strong></li>
              <li>Go to <strong>Credentials</strong> → <strong>Create Credentials</strong> → <strong>OAuth client ID</strong></li>
              <li>Application type: <strong>Web application</strong></li>
              <li>Add redirect URI: <code className="text-xs bg-muted px-1 py-0.5 rounded">{window.location.origin}</code></li>
              <li>Copy the <strong>Client ID</strong> and paste it above</li>
            </ol>
            <p className="mt-2">The app only needs <code className="text-xs bg-muted px-1 py-0.5 rounded">drive.file</code> scope — it can only see and manage files it creates.</p>
          </div>
        </Modal>

        {/* Statement Import Folder */}
        <div>
          <SectionHeader title="Statement Import Folder" />
          <div className="space-y-3">
            {/* Google Drive option */}
            <Card>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-warning/10 flex items-center justify-center flex-shrink-0">
                  <FolderOpen size={16} className="text-warning" />
                </div>
                <div className="flex-1 min-w-0">
                  {getStatementFolderId() ? (
                    <>
                      <p className="text-sm font-semibold text-foreground">✅ Drive folder configured</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {stmtFolderName ?? "Scan for files"}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1 font-mono">{getStatementFolderId()}</p>
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={handleRemoveStmtFolder}
                          className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
                        >
                          Remove Folder
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Go to <strong>Statements</strong> page and tap "Scan Drive Folder" to import files.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-foreground">Google Drive folder (requires API setup)</p>
                      <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                        Paste the ID of a Google Drive folder where you save bank statement files.
                      </p>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Drive folder ID"
                          value={stmtFolderId}
                          onChange={setStmtFolderId}
                          containerClassName="flex-1"
                        />
                        <Button label="Set" onClick={handleSetStmtFolder} variant="primary" size="sm" icon={FolderOpen} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        <button onClick={() => setShowDriveConfig(true)} className="underline">How to find folder ID</button>
                      </p>
                    </>
                  )}
                </div>
              </div>
            </Card>

            {/* Local folder option */}
            <Card>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <FolderOpen size={16} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  {importFolderReady ? (
                    <>
                      <p className="text-sm font-semibold text-foreground">✅ Local folder configured</p>
                      {importFolderName && <p className="text-xs text-muted-foreground mt-0.5">{importFolderName}</p>}
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={handleRemoveImportFolder}
                          className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
                        >
                          Remove Folder
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Go to <strong>Statements</strong> page and tap "Import from Local Folder" to import files.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-foreground">Local folder (no setup needed)</p>
                      <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                        Pick a folder on your computer. Works with your locally-synced Google Drive folder or any folder with CSV/PDF/OFX statement files.
                      </p>
                      <Button label="Choose Folder" onClick={handlePickImportFolder} variant="secondary" size="sm" icon={FolderOpen} />
                    </>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Bank mapping rules */}
        <div>
          <SectionHeader
            title="Bank Mapping Rules"
            action={{ label: "+ Add Rule", onPress: () => setShowBankRule(true) }}
          />
          {bankRules.length === 0 ? (
            <Card>
              <p className="text-sm text-muted-foreground text-center py-2">
                No mapping rules yet. Add rules to auto-categorize bank transactions.
              </p>
              <div className="mt-2">
                <Button label="Add Rule" onClick={() => setShowBankRule(true)} variant="secondary" fullWidth size="sm" icon={Plus} />
              </div>
            </Card>
          ) : (
            <Card padding={false}>
              {bankRules.map((rule, i) => (
                <div
                  key={rule.id}
                  className={cn("flex items-center gap-3 px-4 py-3", i < bankRules.length - 1 && "border-b border-border")}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{rule.keyword}</p>
                    <p className="text-xs text-muted-foreground">
                      {rule.routeTo === "skip"
                        ? rule.transferToAccountId
                          ? `⏭ Transfer → ${accounts.find(a => a.id === rule.transferToAccountId)?.name ?? "?"}`
                          : "⏭ Skip"
                        : rule.routeTo === "goal" ? `⭐ ${goals.find(g => g.id === rule.goalId)?.name ?? "Goal contribution"}`
                        : rule.routeTo === "goalWithdrawal" ? `🔻 ${goals.find(g => g.id === rule.goalId)?.name ?? "Goal withdrawal"}`
                        : `→ ${rule.categoryName ?? "?"}`}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteBankRule(rule.id)}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </Card>
          )}
        </div>

        {/* Danger zone */}
        <div>
          <SectionHeader title="Danger Zone" />
          <Card>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={16} className="text-destructive" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">Clear All Data</p>
                <p className="text-xs text-muted-foreground mb-2">
                  Permanently delete all budgets, expenses, goals and settings. This cannot be undone.
                </p>
                <Button label="Clear All Data" onClick={() => setConfirmClear(true)} variant="danger" size="sm" />
              </div>
            </div>
          </Card>
        </div>

        {/* About */}
        <div className="text-center py-2">
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-2">
            <span className="text-primary-foreground font-bold text-xl">P</span>
          </div>
          <p className="text-sm font-semibold text-foreground">PocketLedger</p>
          <p className="text-xs text-muted-foreground">Your personal budget tracker</p>
          <p className="text-xs text-muted-foreground mt-1">All data stored locally in your browser</p>
        </div>
      </div>

      <BankRuleModal visible={showBankRule} onClose={() => setShowBankRule(false)} />
      <AccountModal
        key={editAccount?.id ?? "new"}
        visible={showAccount}
        onClose={() => { setShowAccount(false); setEditAccount(null); }}
        initial={editAccount ?? undefined}
      />

      <Confirm
        visible={confirmDeleteAccount !== null}
        onClose={() => setConfirmDeleteAccount(null)}
        onConfirm={() => {
          if (confirmDeleteAccount !== null) {
            deleteAccount(confirmDeleteAccount);
            toast.success("Account removed");
          }
        }}
        title="Delete account?"
        message="Expenses and income linked to this account will be kept but unlinked."
        confirmLabel="Delete Account"
      />

      <Confirm
        visible={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={doClearAll}
        title="Clear all data?"
        message="This will permanently delete all your budgets, expenses, goals, and settings. This cannot be undone."
        confirmLabel="Yes, Clear Everything"
      />

      <Confirm
        visible={!!confirmImport}
        onClose={() => setConfirmImport(null)}
        onConfirm={() => {
          if (confirmImport) {
            importData(confirmImport);
            toast.success("Backup restored successfully");
            window.location.reload();
          }
        }}
        title="Restore backup?"
        message="This will replace all your current data with the backup. This cannot be undone."
        confirmLabel="Restore"
        danger={false}
      />
    </div>
  );
}
