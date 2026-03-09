import { Download, AlertCircle, CheckCircle, RotateCcw } from 'lucide-react';
import { DownloadStatus as IDownloadStatus } from '../types/weather';

interface Props {
  status: IDownloadStatus;
  onRefresh: () => void;
}

export function DownloadStatus({ status, onRefresh }: Props) {
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {status.isDownloading ? (
            <>
              <div className="animate-spin">
                <RotateCcw className="h-5 w-5 text-accent" />
              </div>
              <span className="text-slate-300">Downloading weather data...</span>
            </>
          ) : status.error ? (
            <>
              <AlertCircle className="h-5 w-5 text-red-400" />
              <span className="text-red-400">Error: {status.error}</span>
            </>
          ) : status.warning ? (
            <>
              <AlertCircle className="h-5 w-5 text-yellow-400" />
              <span className="text-yellow-300 text-sm">{status.warning}</span>
            </>
          ) : status.lastDownload ? (
            <>
              <CheckCircle className="h-5 w-5 text-green-400" />
              <span className="text-slate-300">
                Last updated: {formatDate(status.lastDownload)}
              </span>
            </>
          ) : (
            <>
              <Download className="h-5 w-5 text-slate-400" />
              <span className="text-slate-400">No weather data available</span>
            </>
          )}
        </div>
        
        <button
          onClick={onRefresh}
          disabled={status.isDownloading}
          className="flex items-center space-x-2 px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:bg-slate-600 disabled:cursor-not-allowed text-slate-900 text-sm rounded-md transition-colors"
        >
          <Download className="h-4 w-4" />
          <span>Refresh</span>
        </button>
      </div>
    </div>
  );
}