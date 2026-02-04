export default function HelpChoiceModal({
  country,
  onSelfHelp,
  onWeHelp,
  onClose,
}) {
  if (!country) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 w-80">
        <h2 className="text-lg font-bold mb-2">
          {country}
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          How would you like help?
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={onSelfHelp}
            className="p-3 rounded bg-black text-white"
          >
            Self-Help
          </button>

          <button
            onClick={onWeHelp}
            className="p-3 rounded border"
          >
            We-Help
          </button>

          <button
            onClick={onClose}
            className="text-sm text-gray-500 mt-2"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
