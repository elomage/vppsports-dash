import React, { useState, useEffect, useCallback, useRef } from 'react';
import './Dashboard.css';
import VisualizationSelection from './Visualizationselection';
import PlaybackControl from './PlaybackControl';
import { loadSlider, saveSlider } from './dashboardState';

const Dashboard = ({ selectedRun }) => {
    const [sliderValue, setSliderValue] = useState(() => loadSlider(selectedRun?._id));
    const [overrideTimestamps, setOverrideTimestamps] = useState(null);
    const lastRunRef = useRef(selectedRun);

    useEffect(() => {
        if (lastRunRef.current === selectedRun) return;
        lastRunRef.current = selectedRun;
        setSliderValue(0);
        setOverrideTimestamps(null);
    }, [selectedRun]);

    useEffect(() => {
        saveSlider(selectedRun?._id, sliderValue);
    }, [selectedRun?._id, sliderValue]);

    const handleEffectiveTimestampsChange = useCallback((timestamps) => {
        setOverrideTimestamps(timestamps && timestamps.length > 0 ? timestamps : null);
    }, []);

    const effectiveRun = overrideTimestamps
        ? { ...selectedRun, totalTimestamps: overrideTimestamps }
        : selectedRun;

    return (
        <div className="dashboard-container w-100">
            <div className="main-content flex-grow-1 w-100" id="dashboard-wrapper">
                {selectedRun && (
                    <>
                        <div className="playback-control-container">
                            <PlaybackControl
                                selectedRun={effectiveRun}
                                sliderValue={sliderValue}
                                setSliderValue={setSliderValue}
                            />
                        </div>
                        <VisualizationSelection
                            selectedRun={selectedRun}
                            effectiveTimestamps={overrideTimestamps}
                            sliderValue={sliderValue}
                            setSliderValue={setSliderValue}
                            onEffectiveTimestampsChange={handleEffectiveTimestampsChange}
                        />
                    </>
                )}
                {!selectedRun && (
                    <div className="no-run-selected">
                        <p>Please select a run from the dropdown above to view visualizations.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dashboard;