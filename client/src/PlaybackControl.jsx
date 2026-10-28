import React, { useState, useEffect, useRef, useCallback } from 'react';
import './PlaybackControl.css';

const formatTime = (timelineValue) => {
    let ms = 0;

    if (!Number.isFinite(timelineValue) || timelineValue <= 0) {
        ms = 0;
    } else if (timelineValue >= 1e15) {
        ms = Math.floor(timelineValue / 1e6);
    } else if (timelineValue >= 1e12) {
        ms = Math.floor(timelineValue / 1e3);
    } else if (timelineValue >= 1e9) {
        ms = Math.floor(timelineValue / 1e6);
    } else if (timelineValue >= 1e6) {
        ms = Math.floor(timelineValue / 1e3);
    } else {
        ms = Math.floor(timelineValue * 1000);
    }

    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = ms % 1000;
    const pad = (unit) => String(unit).padStart(2, '0');

    return {
        main: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
        millis: String(milliseconds).padStart(3, '0'),
    };
};

const PlaybackControl = ({ selectedRun, sliderValue, setSliderValue }) => {
    const [localSliderValue, setLocalSliderValue] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const animationFrameRef = useRef(null);
    const pendingSliderValueRef = useRef(0);
    const timestamps = selectedRun?.totalTimestamps ?? [];
    const maxSliderIndex = Math.max(timestamps.length - 1, 0);
    const currentTimestamp = timestamps[localSliderValue] ?? timestamps[0] ?? 0;
    const timelineStart = timestamps[0] ?? 0;
    const currentTimelineTime = Math.max(currentTimestamp - timelineStart, 0);
    const progress = maxSliderIndex > 0 ? (localSliderValue / maxSliderIndex) * 100 : 0;
    const time = formatTime(currentTimelineTime);

    const flushSliderValue = useCallback(() => {
        animationFrameRef.current = null;
        setSliderValue(pendingSliderValueRef.current);
    }, [setSliderValue]);

    const scheduleSliderUpdate = useCallback((value) => {
        pendingSliderValueRef.current = value;
        if (animationFrameRef.current !== null) return;
        animationFrameRef.current = requestAnimationFrame(flushSliderValue);
    }, [flushSliderValue]);

    const handleInput = (event) => {
        const value = parseInt(event.target.value, 10);
        setLocalSliderValue(value);
        scheduleSliderUpdate(value);
        setIsPlaying(false);
    };

    const pausePlayback = () => {
        setIsPlaying(false);
    };

    const startPlayback = () => {
        setIsPlaying(true);
    };

    const resetPlayback = () => {
        setLocalSliderValue(0);
        scheduleSliderUpdate(0);
        setIsPlaying(false);
    };

    const prevFrame = () => {
        setLocalSliderValue((prevValue) => {
            const newValue = Math.max(prevValue - 1, 0);
            scheduleSliderUpdate(newValue);
            return newValue;
        });
    };

    const nextFrame = () => {
        setLocalSliderValue((prevValue) => {
            const newValue = Math.min(prevValue + 1, maxSliderIndex);
            scheduleSliderUpdate(newValue);
            return newValue;
        });
    };

    useEffect(() => {
        if (!isPlaying) return undefined;
        const speed = 100;
        const interval = setInterval(() => {
            setLocalSliderValue((prevValue) => {
                const newValue = Math.min(prevValue + speed, maxSliderIndex);
                scheduleSliderUpdate(newValue);
                if (newValue >= maxSliderIndex) {
                    setIsPlaying(false);
                }
                return newValue;
            });
        }, 100);
        return () => clearInterval(interval);
    }, [isPlaying, maxSliderIndex, scheduleSliderUpdate]);

    useEffect(() => {
        if (!isPlaying) {
            setLocalSliderValue(sliderValue);
        }
    }, [sliderValue, isPlaying]);

    useEffect(() => () => {
        if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
        }
    }, []);

    return (
        <div className="playback-controls">
            <input
                type="range"
                min="0"
                max={maxSliderIndex}
                value={localSliderValue}
                className="playback-slider"
                id="time-slider"
                style={{ '--progress': `${progress}%` }}
                onInput={handleInput}
                onChange={() => {}}
                aria-label="Timeline position"
            />
            <div className="playback-transport" role="group" aria-label="Playback controls">
                <button id="prev-frame-button" type="button" className="pb-btn" onClick={prevFrame} title="Previous frame">
                    <i className="fas fa-step-backward"></i>
                </button>
                <button
                    id="start-button"
                    type="button"
                    className={`pb-btn pb-btn-primary${isPlaying ? ' is-active' : ''}`}
                    onClick={startPlayback}
                    title="Play"
                >
                    <i className="fas fa-play"></i>
                </button>
                <button id="pause-button" type="button" className="pb-btn" onClick={pausePlayback} title="Pause">
                    <i className="fas fa-pause"></i>
                </button>
                <button id="next-frame-button" type="button" className="pb-btn" onClick={nextFrame} title="Next frame">
                    <i className="fas fa-step-forward"></i>
                </button>
                <button id="reset-button" type="button" className="pb-btn pb-btn-reset" onClick={resetPlayback} title="Back to start">
                    <i className="fas fa-undo"></i>
                </button>
            </div>
            <div id="run-time" className="playback-time" aria-live="off">
                <span className="playback-time-main">{time.main}</span>
                <span className="playback-time-millis">.{time.millis}</span>
            </div>
        </div>
    );
};

export default PlaybackControl;