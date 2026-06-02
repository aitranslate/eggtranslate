// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MobileMenu } from '../MobileMenu';

const mockOnClose = vi.fn();
const mockOnOpenTerms = vi.fn();
const mockOnOpenHistory = vi.fn();
const mockOnOpenSettings = vi.fn();

function setProps(overrides: Partial<React.ComponentProps<typeof MobileMenu>> = {}) {
  return render(
    <MobileMenu
      isOpen={true}
      onClose={mockOnClose}
      termsCount={3}
      historyCount={3}
      isSettingsRequired={true}
      onOpenTerms={mockOnOpenTerms}
      onOpenHistory={mockOnOpenHistory}
      onOpenSettings={mockOnOpenSettings}
      {...overrides}
    />
  );
}

describe('MobileMenu', () => {
  beforeEach(() => {
    mockOnClose.mockClear();
    mockOnOpenTerms.mockClear();
    mockOnOpenHistory.mockClear();
    mockOnOpenSettings.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders nothing visually when isOpen=false', () => {
    setProps({ isOpen: false });
    expect(screen.queryByText('术语')).toBeNull();
  });

  it('shows 3 menu items when isOpen=true', () => {
    setProps();
    expect(screen.getByText('术语')).toBeTruthy();
    expect(screen.getByText('历史')).toBeTruthy();
    expect(screen.getByText('设置')).toBeTruthy();
  });

  it('shows count badges on terms and history items', () => {
    setProps();
    const termItem = screen.getByText('术语').closest('[role="button"]') || screen.getByText('术语').parentElement;
    expect(termItem?.textContent).toContain('3');
  });

  it('shows "必须" badge and orange highlight when isSettingsRequired=true', () => {
    setProps({ isSettingsRequired: true });
    // "必须" badge appears
    expect(screen.getByText('必须')).toBeTruthy();
    // Settings row has orange inline color
    const settingsBtn = screen.getByText('设置').closest('button');
    expect(settingsBtn?.getAttribute('style') || '').toContain('rgb(255, 149, 0)');
  });

  it('does not show "必须" badge when isSettingsRequired=false', () => {
    setProps({ isSettingsRequired: false });
    expect(screen.queryByText('必须')).toBeNull();
  });

  it('calls onOpenTerms when 术语 clicked', () => {
    setProps();
    fireEvent.click(screen.getByText('术语'));
    expect(mockOnOpenTerms).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenHistory when 历史 clicked', () => {
    setProps();
    fireEvent.click(screen.getByText('历史'));
    expect(mockOnOpenHistory).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenSettings when 设置 clicked', () => {
    setProps();
    fireEvent.click(screen.getByText('设置'));
    expect(mockOnOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when ✕ close button clicked', () => {
    setProps();
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
