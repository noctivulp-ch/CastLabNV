import React, {useCallback, useContext, useEffect, useRef, useState} from 'react';
import {FlatList, Image, Keyboard, ScrollView, StyleSheet, TouchableOpacity, View,} from 'react-native';
import {
    ActivityIndicator,
    Button,
    Card,
    Checkbox,
    Chip,
    Dialog,
    IconButton,
    Portal,
    Searchbar,
    SegmentedButtons,
    Text,
    TextInput,
} from 'react-native-paper';
import {ThemeContext} from '../contexts/theme-context';
import {initTranslate} from '../localization/translate';
import {ExtractedVideo, VideoExtractorService} from '../services/VideoExtractorService';
import {ExtractedVideoWithHistory, VideoHistoryService} from '../../db/ExtractedVideoWithHistoryDB';
import {useCastManager} from '../contexts/castManager-context';
import {useDispatch} from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import KeyboardAwareDialog from '../componants/KeyboardAwareDialog';

interface VideoExtractorScreenProps {
    playerHeight?: number;
    onScrollDirectionChange?: (isScrollingDown: boolean) => void;
}

const INVIDIOUS_INSTANCE_KEY = 'invidious_instance';

type ViewMode = 'extract' | 'history';

/**
 * Normalizes a URL by ensuring it has the https:// protocol
 */
const normalizeUrl = (url: string): string => {
    const trimmed = url.trim();
    if (!trimmed) return '';
    const withoutProtocol = trimmed.replace(/^(https?:\/\/)/, '');
    return `https://${withoutProtocol}`;
};

/**
 * Verifies if a URL is a valid Invidious instance
 */
const verifyInvidiousInstance = async (url: string): Promise<boolean> => {
    try {
        const normalizedUrl = normalizeUrl(url);
        const apiUrl = `${normalizedUrl}/api/v1/stats`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {'Accept': 'application/json'},
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) return false;

        const data = await response.json();
        return !!(data && (data.software || data.version || data.usage));
    } catch (error) {
        console.error('Invidious verification error:', error);
        return false;
    }
};

const VideoExtractorScreen: React.FC<VideoExtractorScreenProps> = ({
                                                                       playerHeight = 0,
                                                                       onScrollDirectionChange,
                                                                   }) => {
    const {theme} = useContext(ThemeContext);
    const i18n = initTranslate();
    const dispatch = useDispatch();
    const {castManager} = useCastManager();

    // View mode
    const [viewMode, setViewMode] = useState<ViewMode>('extract');

    // Extraction state
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [videos, setVideos] = useState<ExtractedVideo[]>([]);
    const [pageTitle, setPageTitle] = useState<string | undefined>(undefined);
    const [error, setError] = useState<string | undefined>(undefined);
    const [hasSearched, setHasSearched] = useState(false);

    // History state
    const [historyVideos, setHistoryVideos] = useState<ExtractedVideoWithHistory[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<number>>(new Set());
    const [selectionMode, setSelectionMode] = useState(false);
    const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);

    // Settings state
    const [settingsVisible, setSettingsVisible] = useState(false);
    const [invidiousInstance, setInvidiousInstance] = useState('');
    const [tempInvidiousInstance, setTempInvidiousInstance] = useState('');
    const [verifyingInstance, setVerifyingInstance] = useState(false);
    const [instanceError, setInstanceError] = useState<string | undefined>(undefined);

    // Scroll tracking
    const scrollY = useRef(0);
    const lastScrollY = useRef(0);

    const styles = useStyles(theme);

    /**
     * Load Invidious instance from storage
     */
    useEffect(() => {
        const loadInvidiousInstance = async () => {
            try {
                const saved = await AsyncStorage.getItem(INVIDIOUS_INSTANCE_KEY);
                if (saved) {
                    setInvidiousInstance(saved);
                    VideoExtractorService.setInvidiousInstance(saved);
                } else {
                    const defaultInstance = VideoExtractorService.getInvidiousInstance();
                    setInvidiousInstance(defaultInstance);
                }
            } catch (error) {
                console.error('Failed to load Invidious instance:', error);
            }
        };
        loadInvidiousInstance();
    }, []);

    /**
     * Load history when switching to history view
     */
    useEffect(() => {
        if (viewMode === 'history') {
            loadHistory();
        }
    }, [viewMode]);

    /**
     * Load history from database
     */
    const loadHistory = useCallback(async () => {
        setLoadingHistory(true);
        try {
            const history = await VideoHistoryService.getHistory(200);
            setHistoryVideos(history);
        } catch (error) {
            console.error('Failed to load history:', error);
        } finally {
            setLoadingHistory(false);
        }
    }, []);

    /**
     * Search history
     */
    const handleSearchHistory = useCallback(async (query: string) => {
        setSearchQuery(query);

        if (!query.trim()) {
            loadHistory();
            return;
        }

        setLoadingHistory(true);
        try {
            const results = await VideoHistoryService.searchHistory(query);
            setHistoryVideos(results);
        } catch (error) {
            console.error('Failed to search history:', error);
        } finally {
            setLoadingHistory(false);
        }
    }, [loadHistory]);

    /**
     * Toggle selection for history item
     */
    const toggleHistorySelection = useCallback((historyId: number) => {
        setSelectedHistoryIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(historyId)) {
                newSet.delete(historyId);
            } else {
                newSet.add(historyId);
            }
            return newSet;
        });
    }, []);

    /**
     * Select all history items
     */
    const selectAllHistory = useCallback(() => {
        const allIds = new Set(historyVideos.map(v => v.historyId));
        setSelectedHistoryIds(allIds);
    }, [historyVideos]);

    /**
     * Deselect all history items
     */
    const deselectAllHistory = useCallback(() => {
        setSelectedHistoryIds(new Set());
    }, []);

    /**
     * Delete selected history items
     */
    const deleteSelectedHistory = useCallback(async () => {
        try {
            await VideoHistoryService.deleteVideos(Array.from(selectedHistoryIds));
            setSelectedHistoryIds(new Set());
            setSelectionMode(false);
            setDeleteDialogVisible(false);
            await loadHistory();
        } catch (error) {
            console.error('Failed to delete history:', error);
        }
    }, [selectedHistoryIds, loadHistory]);

    /**
     * Delete single history item
     */
    const deleteSingleHistory = useCallback(async (historyId: number) => {
        try {
            await VideoHistoryService.deleteVideo(historyId);
            await loadHistory();
        } catch (error) {
            console.error('Failed to delete history item:', error);
        }
    }, [loadHistory]);

    /**
     * Save Invidious instance after validation
     */
    const handleSaveInvidiousInstance = useCallback(async () => {
        if (!tempInvidiousInstance.trim()) {
            setInstanceError(i18n.t('invalid_instance_url'));
            return;
        }

        const normalizedUrl = normalizeUrl(tempInvidiousInstance);

        setVerifyingInstance(true);
        setInstanceError(undefined);

        try {
            const isValid = await verifyInvidiousInstance(normalizedUrl);

            if (!isValid) {
                setInstanceError(i18n.t('not_an_invidious_instance'));
                setVerifyingInstance(false);
                return;
            }

            await AsyncStorage.setItem(INVIDIOUS_INSTANCE_KEY, normalizedUrl);
            setInvidiousInstance(normalizedUrl);
            VideoExtractorService.setInvidiousInstance(normalizedUrl);
            setSettingsVisible(false);
            setInstanceError(undefined);
        } catch (error) {
            console.error('Failed to save Invidious instance:', error);
            setInstanceError(i18n.t('instance_verification_failed'));
        } finally {
            setVerifyingInstance(false);
        }
    }, [tempInvidiousInstance, i18n]);

    /**
     * Reset to default Invidious instance
     */
    const handleResetInvidiousInstance = useCallback(async () => {
        try {
            await AsyncStorage.removeItem(INVIDIOUS_INSTANCE_KEY);
            VideoExtractorService.setInvidiousInstance(null);
            const defaultInstance = VideoExtractorService.getInvidiousInstance();
            setInvidiousInstance(defaultInstance);
            setTempInvidiousInstance(defaultInstance);
            setInstanceError(undefined);
        } catch (error) {
            console.error('Failed to reset Invidious instance:', error);
        }
    }, []);

    /**
     * Open settings dialog
     */
    const handleOpenSettings = useCallback(() => {
        setTempInvidiousInstance(invidiousInstance);
        setInstanceError(undefined);
        setSettingsVisible(true);
    }, [invidiousInstance]);

    /**
     * Handle URL extraction
     */
    const handleExtract = useCallback(async () => {
        if (!url.trim()) {
            setError(i18n.t('please_enter_url'));
            return;
        }

        Keyboard.dismiss();
        setLoading(true);
        setError(undefined);
        setVideos([]);
        setPageTitle(undefined);
        setHasSearched(true);

        try {
            const result = await VideoExtractorService.extractFromUrl(url.trim());

            if (result.success) {
                setVideos(result.videos);
                setPageTitle(result.pageTitle);

                // Save to history
                if (result.videos.length > 0) {
                    await VideoHistoryService.saveExtraction(
                        result.videos,
                        url.trim(),
                        result.pageTitle
                    );
                }

                if (result.videos.length === 0) {
                    setError(i18n.t('no_videos_found'));
                }
            } else {
                setError(result.error || i18n.t('extraction_failed'));
            }
        } catch (err) {
            setError((err as Error).message || i18n.t('extraction_failed'));
        } finally {
            setLoading(false);
        }
    }, [url, i18n]);

    /**
     * Handle video cast
     */
    const handleCastVideo = useCallback(async (video: ExtractedVideo | ExtractedVideoWithHistory) => {
        if (!castManager.isConnected()) {
            setError(i18n.t('please_connect_cast_device'));
            return;
        }

        try {
            // For web-extracted videos, cast the URL directly without going through Redux
            // This bypasses the local server requirement in Main.tsx
            const metadata = {
                title: video.title,
                images: video.thumbnail ? [{url: video.thumbnail, width: 640, height: 480}] : [],
            };

            await castManager.castMedia({
                contentUrl: video.url,
                metadata,
                streamDuration: 0,
            });

            console.log(`Casting video: ${video.title}`);
        } catch (err) {
            console.error('Cast error:', err);
            setError((err as Error).message || i18n.t('cast_failed'));
        }
    }, [castManager, i18n]);

    /**
     * Handle scroll for compact mode
     */
    const handleScroll = useCallback((event: any) => {
        const currentScrollY = event.nativeEvent.contentOffset.y;
        scrollY.current = currentScrollY;

        const isScrollingDown = currentScrollY > lastScrollY.current && currentScrollY > 50;
        lastScrollY.current = currentScrollY;

        onScrollDirectionChange?.(isScrollingDown);
    }, [onScrollDirectionChange]);

    /**
     * Clear results
     */
    const handleClear = useCallback(() => {
        setUrl('');
        setVideos([]);
        setPageTitle(undefined);
        setError(undefined);
        setHasSearched(false);
    }, []);

    /**
     * Render video item for extraction results
     */
    const renderVideoItem = useCallback(({item}: { item: ExtractedVideo }) => {
        return (
            <Card style={styles.videoCard}>
                <View style={styles.videoContent}>
                    <View style={styles.thumbnailContainer}>
                        {item.thumbnail ? (
                            <Image
                                source={{uri: item.thumbnail}}
                                style={styles.thumbnail}
                                resizeMode="cover"
                            />
                        ) : (
                            <View style={[styles.thumbnailPlaceholder, {backgroundColor: theme.colors.surfaceVariant}]}>
                                <IconButton
                                    icon="video"
                                    size={32}
                                    iconColor={theme.colors.onSurfaceVariant}
                                />
                            </View>
                        )}
                    </View>

                    <View style={styles.videoInfo}>
                        <Text variant="titleMedium" numberOfLines={2} style={styles.videoTitle}>
                            {item.title}
                        </Text>

                        <View style={styles.videoMeta}>
                            {item.format && (
                                <Chip mode="outlined" compact
                                      icon={item.dlnaCompat === 'unsupported' ? 'alert-outline' : undefined}
                                      style={styles.formatChip} textStyle={styles.chipText}>
                                    {item.format}
                                </Chip>
                            )}
                        </View>
                    </View>

                    <TouchableOpacity onPress={() => handleCastVideo(item)} style={styles.castButton}>
                        <IconButton icon="cast" size={24} iconColor={theme.colors.primary}/>
                    </TouchableOpacity>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.videoUrlScroll}>
                    <Text variant="labelSmall" numberOfLines={1} style={styles.videoUrl}>
                        {item.url}
                    </Text>
                </ScrollView>
            </Card>
        );
    }, [theme, handleCastVideo, styles, i18n]);

    /**
     * Render history video item
     */
    const renderHistoryItem = useCallback(({item}: { item: ExtractedVideoWithHistory }) => {
        const isSelected = selectedHistoryIds.has(item.historyId);

        return (
            <Card style={styles.videoCard}>
                <View style={styles.videoContent}>
                    {selectionMode && (
                        <View style={styles.checkboxContainer}>
                            <Checkbox
                                status={isSelected ? 'checked' : 'unchecked'}
                                onPress={() => toggleHistorySelection(item.historyId)}
                            />
                        </View>
                    )}

                    <View style={styles.thumbnailContainer}>
                        {item.thumbnail ? (
                            <Image source={{uri: item.thumbnail}} style={styles.thumbnail} resizeMode="cover"/>
                        ) : (
                            <View style={[styles.thumbnailPlaceholder, {backgroundColor: theme.colors.surfaceVariant}]}>
                                <IconButton icon="video" size={32} iconColor={theme.colors.onSurfaceVariant}/>
                            </View>
                        )}
                    </View>

                    <View style={styles.videoInfo}>
                        <Text variant="titleMedium" numberOfLines={2} style={styles.videoTitle}>
                            {item.title}
                        </Text>

                        {item.pageTitle && (
                            <Text variant="bodySmall" numberOfLines={1} style={styles.pageTitle}>
                                {i18n.t('from')}: {item.pageTitle}
                            </Text>
                        )}

                        <View style={styles.videoMeta}>
                            {item.format && (
                                <Chip mode="outlined" compact
                                      icon={item.dlnaCompat === 'unsupported' ? 'alert-outline' : undefined}
                                      style={styles.formatChip} textStyle={styles.chipText}>
                                    {item.format}
                                </Chip>
                            )}
                            <Text variant="bodySmall" style={styles.extractedDate}>
                                {new Date(item.extractedAt).toLocaleDateString()}
                            </Text>
                        </View>
                    </View>

                    {!selectionMode && (
                        <>
                            <TouchableOpacity onPress={() => handleCastVideo(item)} style={styles.castButton}>
                                <IconButton icon="cast" size={24} iconColor={theme.colors.primary}/>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => deleteSingleHistory(item.historyId)}
                                              style={styles.deleteButton}>
                                <IconButton icon="delete" size={20} iconColor={theme.colors.error}/>
                            </TouchableOpacity>
                        </>
                    )}
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.videoUrlScroll}>
                    <Text variant="labelSmall" numberOfLines={1} style={styles.videoUrl}>
                        {item.url}
                    </Text>
                </ScrollView>
            </Card>
        );
    }, [theme, selectionMode, selectedHistoryIds, toggleHistorySelection, handleCastVideo, deleteSingleHistory, styles, i18n]);

    /**
     * Render empty state
     */
    const renderEmptyState = () => {
        if (loading || loadingHistory) return null;

        if (viewMode === 'history') {
            if (historyVideos.length === 0) {
                return (
                    <View style={styles.emptyState}>
                        <IconButton icon="history" size={64} iconColor={theme.colors.onSurfaceVariant}/>
                        <Text variant="titleMedium" style={styles.emptyTitle}>
                            {i18n.t('no_extraction_history')}
                        </Text>
                        <Text variant="bodyMedium" style={styles.emptyDescription}>
                            {i18n.t('extract_videos_to_see_history')}
                        </Text>
                    </View>
                );
            }
            return null;
        }

        if (!hasSearched) {
            return (
                <View style={styles.emptyState}>
                    <IconButton icon="web" size={64} iconColor={theme.colors.onSurfaceVariant}/>
                    <Text variant="titleMedium" style={styles.emptyTitle}>
                        {i18n.t('extract_videos_from_web')}
                    </Text>
                    <Text variant="bodyMedium" style={styles.emptyDescription}>
                        {i18n.t('enter_webpage_url_to_find_videos')}
                    </Text>
                </View>
            );
        }

        if (error) {
            return (
                <View style={styles.emptyState}>
                    <IconButton icon="alert-circle" size={64} iconColor={theme.colors.error}/>
                    <Text variant="titleMedium" style={[styles.emptyTitle, {color: theme.colors.error}]}>
                        {i18n.t('error.single')}
                    </Text>
                    <Text variant="bodyMedium" style={styles.emptyDescription}>
                        {error}
                    </Text>
                </View>
            );
        }

        if (videos.length === 0) {
            return (
                <View style={styles.emptyState}>
                    <IconButton icon="video-off" size={64} iconColor={theme.colors.onSurfaceVariant}/>
                    <Text variant="titleMedium" style={styles.emptyTitle}>
                        {i18n.t('no_videos_found')}
                    </Text>
                    <Text variant="bodyMedium" style={styles.emptyDescription}>
                        {i18n.t('no_videos_in_page_html')}
                    </Text>
                </View>
            );
        }

        return null;
    };

    return (
        <View style={[styles.container, {backgroundColor: theme.colors.background}]}>
            {/* View mode selector */}
            <View style={styles.modeSelector}>
                <SegmentedButtons
                    value={viewMode}
                    onValueChange={(value) => setViewMode(value as ViewMode)}
                    buttons={[
                        {value: 'extract', label: i18n.t('extract'), icon: 'web'},
                        {value: 'history', label: i18n.t('history'), icon: 'history'},
                    ]}
                />
            </View>

            {/* Extract mode */}
            {viewMode === 'extract' && (
                <>
                    <View style={styles.header}>
                        <View style={styles.urlInputRow}>
                            <TextInput
                                mode="outlined"
                                label={i18n.t('webpage_url')}
                                placeholder="https://example.com/page"
                                value={url}
                                onChangeText={setUrl}
                                onSubmitEditing={handleExtract}
                                style={styles.urlInput}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="url"
                                right={url.length > 0 ?
                                    <TextInput.Icon icon="close" onPress={handleClear}/> : undefined}
                            />
                            <IconButton icon="cog" size={24} onPress={handleOpenSettings}
                                        style={styles.settingsButton}/>
                        </View>

                        <View style={styles.buttonRow}>
                            <Button
                                mode="contained"
                                onPress={handleExtract}
                                loading={loading}
                                disabled={loading || !url.trim()}
                                style={styles.extractButton}
                                icon="web"
                            >
                                {i18n.t('extract')}
                            </Button>
                        </View>

                        {url.toLowerCase().includes('youtube.com') || url.toLowerCase().includes('youtu.be') ? (
                            <Chip icon="information" style={styles.infoChip} textStyle={styles.infoChipText}>
                                {i18n.t('youtube_conversion_info')}
                            </Chip>
                        ) : null}

                        {url.toLowerCase().endsWith('.m3u') || url.toLowerCase().endsWith('.m3u8') ? (
                            <Chip icon="playlist-music" style={styles.infoChip} textStyle={styles.infoChipText}>
                                {i18n.t('m3u_playlist_detected')}
                            </Chip>
                        ) : null}

                        {pageTitle && (
                            <Card style={styles.pageTitleCard}>
                                <Card.Content>
                                    <Text variant="labelSmall" style={styles.pageTitleLabel}>
                                        {i18n.t('page_title')}
                                    </Text>
                                    <Text variant="bodyMedium" numberOfLines={2}>
                                        {pageTitle}
                                    </Text>
                                </Card.Content>
                            </Card>
                        )}

                        {videos.length > 0 && (
                            <View style={styles.resultsHeader}>
                                <Text variant="titleSmall" style={styles.resultsCount}>
                                    {i18n.t('videos_found', {count: videos.length})}
                                </Text>
                            </View>
                        )}
                    </View>

                    {loading && (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="large" color={theme.colors.primary}/>
                            <Text variant="bodyMedium" style={styles.loadingText}>
                                {i18n.t('extracting_videos')}
                            </Text>
                        </View>
                    )}

                    {!loading && (
                        <FlatList
                            data={videos}
                            keyExtractor={(item) => item.id}
                            renderItem={renderVideoItem}
                            contentContainerStyle={[styles.listContent, {paddingBottom: playerHeight + 16}]}
                            onScroll={handleScroll}
                            scrollEventThrottle={16}
                            ListEmptyComponent={renderEmptyState}
                        />
                    )}
                </>
            )}

            {/* History mode */}
            {viewMode === 'history' && (
                <>
                    <View style={styles.historyHeader}>
                        <Searchbar
                            placeholder={i18n.t('search_videos')}
                            onChangeText={handleSearchHistory}
                            value={searchQuery}
                            style={styles.searchBar}
                        />

                        <View style={styles.historyActions}>
                            {selectionMode ? (
                                <>
                                    <Button mode="text" onPress={selectAllHistory} compact>
                                        {i18n.t('select_all')}
                                    </Button>
                                    <Button mode="text" onPress={deselectAllHistory} compact>
                                        {i18n.t('deselect_all')}
                                    </Button>
                                    <Button
                                        mode="contained"
                                        onPress={() => setDeleteDialogVisible(true)}
                                        disabled={selectedHistoryIds.size === 0}
                                        compact
                                        buttonColor={theme.colors.error}
                                    >
                                        {i18n.t('delete')} ({selectedHistoryIds.size})
                                    </Button>
                                    <Button mode="text" onPress={() => {
                                        setSelectionMode(false);
                                        deselectAllHistory();
                                    }} compact>
                                        {i18n.t('cancel')}
                                    </Button>
                                </>
                            ) : (
                                <Button mode="outlined" onPress={() => setSelectionMode(true)}
                                        icon="checkbox-marked-outline">
                                    {i18n.t('select')}
                                </Button>
                            )}
                        </View>
                    </View>

                    {loadingHistory && (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="large" color={theme.colors.primary}/>
                            <Text variant="bodyMedium" style={styles.loadingText}>
                                {i18n.t('loading')}...
                            </Text>
                        </View>
                    )}

                    {!loadingHistory && (
                        <FlatList
                            data={historyVideos}
                            keyExtractor={(item) => item.historyId.toString()}
                            renderItem={renderHistoryItem}
                            contentContainerStyle={[styles.listContent, {paddingBottom: playerHeight + 16}]}
                            onScroll={handleScroll}
                            scrollEventThrottle={16}
                            ListEmptyComponent={renderEmptyState}
                        />
                    )}
                </>
            )}

            {/* Settings Dialog */}
            <Portal>
                <KeyboardAwareDialog visible={settingsVisible} onDismiss={() => setSettingsVisible(false)}>
                    <Dialog.Title>{i18n.t('video_extractor_settings')}</Dialog.Title>
                    <Dialog.Content>
                        <Text variant="bodyMedium" style={{marginBottom: 8}}>
                            {i18n.t('invidious_instance')}
                        </Text>
                        <Text variant="bodySmall" style={{marginBottom: 12, color: theme.colors.onSurfaceVariant}}>
                            {i18n.t('invidious_instance_description')}
                        </Text>
                        <TextInput
                            mode="outlined"
                            label={i18n.t('invidious_instance_url')}
                            placeholder="yewtu.be"
                            value={tempInvidiousInstance}
                            onChangeText={(text) => {
                                setTempInvidiousInstance(text);
                                setInstanceError(undefined);
                            }}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="url"
                            style={{marginBottom: 8}}
                            error={!!instanceError}
                            disabled={verifyingInstance}
                        />
                        {instanceError && (
                            <Text variant="bodySmall" style={{color: theme.colors.error, marginBottom: 8}}>
                                {instanceError}
                            </Text>
                        )}
                        {verifyingInstance && (
                            <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 8}}>
                                <ActivityIndicator size="small" color={theme.colors.primary} style={{marginRight: 8}}/>
                                <Text variant="bodySmall" style={{color: theme.colors.onSurfaceVariant}}>
                                    {i18n.t('verifying_instance')}
                                </Text>
                            </View>
                        )}
                        <Text variant="bodySmall" style={{color: theme.colors.onSurfaceVariant, marginBottom: 8}}>
                            {i18n.t('current_instance', {instance: invidiousInstance})}
                        </Text>
                        <Button mode="text" onPress={handleResetInvidiousInstance} icon="refresh"
                                disabled={verifyingInstance}>
                            {i18n.t('reset_to_default')}
                        </Button>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setSettingsVisible(false)} disabled={verifyingInstance}>
                            {i18n.t('cancel')}
                        </Button>
                        <Button onPress={handleSaveInvidiousInstance}
                                disabled={verifyingInstance || !tempInvidiousInstance.trim()}>
                            {i18n.t('save')}
                        </Button>
                    </Dialog.Actions>
                </KeyboardAwareDialog>
            </Portal>

            {/* Delete confirmation dialog */}
            <Portal>
                <Dialog visible={deleteDialogVisible} onDismiss={() => setDeleteDialogVisible(false)}>
                    <Dialog.Title>{i18n.t('delete_selected_items')}</Dialog.Title>
                    <Dialog.Content>
                        <Text variant="bodyMedium">
                            {i18n.t('delete_selected_items_confirmation', {count: selectedHistoryIds.size})}
                        </Text>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setDeleteDialogVisible(false)}>{i18n.t('cancel')}</Button>
                        <Button onPress={deleteSelectedHistory} textColor={theme.colors.error}>
                            {i18n.t('delete')}
                        </Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>
        </View>
    );
};

const useStyles = (theme: any) => StyleSheet.create({
    container: {
        flex: 1,
    },
    modeSelector: {
        padding: 16,
        paddingBottom: 8,
    },
    header: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.outlineVariant,
    },
    historyHeader: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.outlineVariant,
    },
    searchBar: {
        marginBottom: 12,
    },
    historyActions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    urlInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    urlInput: {
        flex: 1,
        marginRight: 8,
    },
    settingsButton: {
        margin: 0,
    },
    buttonRow: {
        flexDirection: 'row',
        gap: 8,
    },
    extractButton: {
        flex: 1,
    },
    infoChip: {
        marginTop: 8,
        alignSelf: 'flex-start',
        backgroundColor: theme.colors.secondaryContainer,
    },
    infoChipText: {
        fontSize: 11,
        color: theme.colors.onSecondaryContainer,
    },
    pageTitleCard: {
        marginTop: 12,
        backgroundColor: theme.colors.surfaceVariant,
    },
    pageTitleLabel: {
        color: theme.colors.onSurfaceVariant,
        marginBottom: 4,
    },
    resultsHeader: {
        marginTop: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    resultsCount: {
        color: theme.colors.primary,
        fontWeight: '600',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
    },
    loadingText: {
        marginTop: 16,
        color: theme.colors.onSurfaceVariant,
    },
    listContent: {
        padding: 16,
        flexGrow: 1,
    },
    videoCard: {
        marginBottom: 12,
        elevation: 2,
    },
    videoContent: {
        flexDirection: 'row',
        padding: 12,
        alignItems: 'center',
    },
    checkboxContainer: {
        justifyContent: 'center',
        marginRight: 8,
    },
    thumbnailContainer: {
        width: 120,
        height: 68,
        marginRight: 12,
        borderRadius: 8,
        overflow: 'hidden',
    },
    thumbnail: {
        width: '100%',
        height: '100%',
    },
    thumbnailPlaceholder: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    videoInfo: {
        flex: 1,
        marginRight: 8,
    },
    videoTitle: {
        fontWeight: '600',
        marginBottom: 6,
    },
    pageTitle: {
        color: theme.colors.onSurfaceVariant,
        fontStyle: 'italic',
        marginBottom: 4,
    },
    videoMeta: {
        flexDirection: 'row',
        gap: 6,
        marginBottom: 6,
        alignItems: 'center',
    },
    formatChip: {
        height: 28,
    },
    sourceChip: {
        height: 28,
    },
    chipText: {
        fontSize: 10,
        marginVertical: 0,
    },
    extractedDate: {
        color: theme.colors.onSurfaceVariant,
        fontSize: 11,
    },
    videoUrlScroll: {
        marginHorizontal: 12,
        marginBottom: 10,
    },
    videoUrl: {
        color: theme.colors.onSurfaceVariant,
        fontFamily: 'monospace',
    },
    castButton: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    deleteButton: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
    },
    emptyTitle: {
        marginTop: 16,
        marginBottom: 8,
        textAlign: 'center',
    },
    emptyDescription: {
        color: theme.colors.onSurfaceVariant,
        textAlign: 'center',
        maxWidth: 300,
    },
});

export default VideoExtractorScreen;