import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../workspaceStore';

describe('workspaceStore mobile editor stack', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      stage: 'editor',
      settingsOpen: false,
      settingsFocus: null,
      mobileEditorOpen: false,
    });
  });

  it('openMobileEditor does not depend on selectedFileId and is not opened by openEditor', () => {
    useWorkspaceStore.getState().openEditor();
    expect(useWorkspaceStore.getState().mobileEditorOpen).toBe(false);

    useWorkspaceStore.getState().openMobileEditor();
    expect(useWorkspaceStore.getState()).toMatchObject({
      stage: 'editor',
      mobileEditorOpen: true,
    });
  });

  it('leaving the project stage closes the mobile editor but settings do not', () => {
    useWorkspaceStore.getState().openMobileEditor();
    useWorkspaceStore.getState().openSettings('translation');
    expect(useWorkspaceStore.getState().mobileEditorOpen).toBe(true);

    useWorkspaceStore.getState().openTerms();
    expect(useWorkspaceStore.getState()).toMatchObject({
      stage: 'terms',
      mobileEditorOpen: false,
    });

    useWorkspaceStore.getState().openMobileEditor();
    useWorkspaceStore.getState().openHistory();
    expect(useWorkspaceStore.getState().mobileEditorOpen).toBe(false);

    useWorkspaceStore.getState().openMobileEditor();
    useWorkspaceStore.getState().openEditor();
    expect(useWorkspaceStore.getState().mobileEditorOpen).toBe(false);
  });
});
