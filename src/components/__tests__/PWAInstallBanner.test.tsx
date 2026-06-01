// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { PWAInstallBanner } from '../PWAInstallBanner';
import type { UsePWAInstallResult } from '../../pwa/usePWAInstall';

const mockUsePWAInstall = vi.fn<() => UsePWAInstallResult>();
vi.mock('../../pwa/usePWAInstall', () => ({
  usePWAInstall: () => mockUsePWAInstall(),
}));

function setHookState(state: Partial<UsePWAInstallResult>) {
  mockUsePWAInstall.mockReturnValue({
    shouldShow: false,
    deferredPrompt: null,
    isIOS: false,
    dismiss: vi.fn(),
    install: vi.fn().mockResolvedValue(undefined),
    ...state,
  });
}

describe('PWAInstallBanner', () => {
  beforeEach(() => {
    mockUsePWAInstall.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders nothing when shouldShow=false', () => {
    setHookState({ shouldShow: false });
    const { container } = render(<PWAInstallBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the standard banner for non-iOS with deferredPrompt', () => {
    setHookState({
      shouldShow: true,
      isIOS: false,
      deferredPrompt: { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }), platforms: ['web'] } as unknown as NonNullable<UsePWAInstallResult['deferredPrompt']>,
    });

    render(<PWAInstallBanner />);

    expect(screen.getByText('安装到桌面')).toBeTruthy();
    expect(screen.getByText(/独立窗口|桌面图标/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '安装' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy();
  });

  it('renders the iOS guide when isIOS=true', () => {
    setHookState({
      shouldShow: true,
      isIOS: true,
      deferredPrompt: null,
    });

    render(<PWAInstallBanner />);

    expect(screen.getByText(/分享/)).toBeTruthy();
    expect(screen.getByText(/主屏幕/)).toBeTruthy();
    // iOS 模式不显示 "安装" 按钮（用户手动操作）
    expect(screen.queryByRole('button', { name: '安装' })).toBeNull();
  });

  it('clicking the install button calls install()', async () => {
    const installMock = vi.fn().mockResolvedValue(undefined);
    setHookState({
      shouldShow: true,
      isIOS: false,
      install: installMock,
    });

    render(<PWAInstallBanner />);
    const btn = screen.getByRole('button', { name: '安装' });

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(installMock).toHaveBeenCalledTimes(1);
  });

  it('clicking the close button calls dismiss()', () => {
    const dismissMock = vi.fn();
    setHookState({
      shouldShow: true,
      isIOS: false,
      dismiss: dismissMock,
    });

    render(<PWAInstallBanner />);
    const btn = screen.getByRole('button', { name: '关闭' });

    fireEvent.click(btn);

    expect(dismissMock).toHaveBeenCalledTimes(1);
  });
});
