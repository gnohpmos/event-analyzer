import React, { useState, useEffect } from 'react';
import { api } from './services/api';
import { DashboardSummary } from './types';
import { DashboardView } from './components/DashboardView';
import { IncidentsView } from './components/IncidentsView';
import { DevicesView } from './components/DevicesView';
import { EventsView } from './components/EventsView';
import { SettingsView } from './components/SettingsView';
import { ReportView } from './components/ReportView';
import { IncidentDetailModal } from './components/IncidentDetailModal';
import { ThemeProvider } from './context/ThemeContext';
import { ThemeSwitcher } from './components/ThemeSwitcher';

type TabType = 'dashboard' | 'incidents' | 'devices' | 'events' | 'report' | 'settings';

const AppContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(null);

  useEffect(() => {
    loadSummary();
    const interval = setInterval(loadSummary, 15000);
    return () => clearInterval(interval);
  }, []);

  const loadSummary = async () => {
    try {
      const data = await api.getDashboardSummary();
      setSummary(data);
    } catch (err) {
      console.error('Failed to load dashboard summary:', err);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans transition-colors duration-200">
      {/* Top Navbar */}
      <header className="bg-card/90 backdrop-blur border-b border-border sticky top-0 z-40 transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo and Brand */}
            <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('dashboard')}>
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-primary to-indigo-500 flex items-center justify-center shadow-md shadow-primary/20">
                <svg className="w-5 h-5 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <span className="text-base font-bold tracking-tight text-foreground block">EventAnalyzer</span>
                <span className="text-[10px] text-primary font-medium tracking-wide uppercase block -mt-1">
                  Multi-Source Network RCA
                </span>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="hidden md:flex space-x-1">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'dashboard'
                    ? 'bg-primary text-primary-foreground shadow-sm font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
              >
                Dashboard
              </button>

              <button
                onClick={() => setActiveTab('incidents')}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'incidents'
                    ? 'bg-primary text-primary-foreground shadow-sm font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
              >
                Incidents
              </button>

              <button
                onClick={() => setActiveTab('devices')}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'devices'
                    ? 'bg-primary text-primary-foreground shadow-sm font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
              >
                Devices
              </button>

              <button
                onClick={() => setActiveTab('events')}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'events'
                    ? 'bg-primary text-primary-foreground shadow-sm font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
              >
                Events Audit
              </button>

              <button
                onClick={() => setActiveTab('report')}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'report'
                    ? 'bg-primary text-primary-foreground shadow-sm font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
              >
                Reports
              </button>

              <button
                onClick={() => setActiveTab('settings')}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all flex items-center space-x-1.5 ${
                  activeTab === 'settings'
                    ? 'bg-primary text-primary-foreground shadow-sm font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>Admin Settings</span>
              </button>
            </nav>

            {/* Right side actions */}
            <div className="flex items-center space-x-3">
              {/* Theme Switcher */}
              <ThemeSwitcher />

              <span className="hidden lg:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse" />
                Engine Active
              </span>


            </div>
          </div>
        </div>

        {/* Mobile Navigation bar */}
        <div className="md:hidden border-t border-border px-4 py-2 flex items-center justify-between bg-card/95">
          <div className="flex space-x-1">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`text-xs font-medium py-1 px-2 rounded ${activeTab === 'dashboard' ? 'text-primary font-bold bg-primary/10' : 'text-muted-foreground'}`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setActiveTab('incidents')}
              className={`text-xs font-medium py-1 px-2 rounded ${activeTab === 'incidents' ? 'text-primary font-bold bg-primary/10' : 'text-muted-foreground'}`}
            >
              Incidents
            </button>
            <button
              onClick={() => setActiveTab('devices')}
              className={`text-xs font-medium py-1 px-2 rounded ${activeTab === 'devices' ? 'text-primary font-bold bg-primary/10' : 'text-muted-foreground'}`}
            >
              Devices
            </button>
            <button
              onClick={() => setActiveTab('events')}
              className={`text-xs font-medium py-1 px-2 rounded ${activeTab === 'events' ? 'text-primary font-bold bg-primary/10' : 'text-muted-foreground'}`}
            >
              Events
            </button>
            <button
              onClick={() => setActiveTab('report')}
              className={`text-xs font-medium py-1 px-2 rounded ${activeTab === 'report' ? 'text-primary font-bold bg-primary/10' : 'text-muted-foreground'}`}
            >
              Reports
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`text-xs font-medium py-1 px-2 rounded ${activeTab === 'settings' ? 'text-primary font-bold bg-primary/10' : 'text-muted-foreground'}`}
            >
              Settings
            </button>
          </div>
          <ThemeSwitcher compact={true} />
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'dashboard' && (
          <DashboardView
            summary={summary}
            onSelectIncident={(id) => setSelectedIncidentId(id)}
            onViewAllIncidents={() => setActiveTab('incidents')}
          />
        )}
        {activeTab === 'incidents' && <IncidentsView />}
        {activeTab === 'devices' && <DevicesView />}
        {activeTab === 'events' && <EventsView />}
        {activeTab === 'report' && (
          <ReportView onSelectIncident={(id) => setSelectedIncidentId(id)} />
        )}
        {activeTab === 'settings' && <SettingsView />}
      </main>

      {/* Incident Detail Modal for Dashboard */}
      {selectedIncidentId !== null && (
        <IncidentDetailModal
          incidentId={selectedIncidentId}
          onClose={() => {
            setSelectedIncidentId(null);
            loadSummary();
          }}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-border bg-card/60 py-5 text-center text-xs text-muted-foreground transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Multi-Source Network Event & Incident Analysis Platform &bull; v1.0.0</span>
          <span>Automated SNMP sysUpTime RCA Engine &bull; Port 8089</span>
        </div>
      </footer>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
};

export default App;
