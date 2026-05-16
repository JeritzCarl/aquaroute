import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, SegmentChangeEventDetail } from '@ionic/angular';
import { Firestore, collection, onSnapshot } from '@angular/fire/firestore';
import { Chart, registerables } from 'chart.js';
import { MLWeightService } from '../services/ml-weight.service';
import { AfterViewInit } from '@angular/core';

Chart.register(...registerables);

type ViewMode = 'barangay' | 'actual_vs_predicted' | 'feature_importance';

interface DeliveryLogRow {
  barangay: string;
  durationMinutes: number;
  predictedMinutes: number;
  predictionError: number;
  distanceKm: number;
  itemCount: number;
  hourBucket: string;
}

interface StatsRow {
  barangay: string;
  avgMinutes: number;
  totalTrips: number;
}

@Component({
  selector: 'app-ml-visualization',
  standalone: true,
  templateUrl: './ml-visualization.page.html',
  styleUrls: ['./ml-visualization.page.scss'],
  imports: [CommonModule, IonicModule, FormsModule],
})
export class MlVisualizationPage implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('mlChartCanvas') mlChartCanvas?: ElementRef<HTMLCanvasElement>;
  private unsubscribeLogs: (() => void) | null = null;
  private unsubscribeStats: (() => void) | null = null;
  private chart: Chart | null = null;

  private logs: DeliveryLogRow[] = [];
  private statsRows: StatsRow[] = [];
  barangayOptions: string[] = [];

  viewMode: ViewMode = 'barangay';

  totalLoggedDeliveries = 0;
  averagePredictionError = 0;
  bestBarangay = 'N/A';

  selectedBarangay = 'ALL';
  selectedBarangayAvgMinutes = 0;
  selectedBarangayTrips = 0;

  averageDistanceKm = 0;
  averageItemCount = 0;
  morningAverageMinutes = 0;
  afternoonAverageMinutes = 0;
  eveningAverageMinutes = 0;

  chartReady = false;
  chartEmpty = false;
  chartEmptyMessage = 'No chart data available yet.';
  chartTitle = 'Average Delivery Time by Area (Minutes)';
  chartLegendTitle = 'Chart Guide';
  chartLegendText = '';
  chartAnalysisTitle = 'Chart Analysis';
  chartAnalysis = '';
  xAxisLabel = '';
  yAxisLabel = '';

  constructor(
    private firestore: Firestore,
    private mlWeightService: MLWeightService
  ) {}

  ngOnInit(): void {
    this.listenToSummaryStats();

    setTimeout(() => {
      this.refreshChart();
    }, 300);
  }

  ngOnDestroy(): void {
    if (this.unsubscribeLogs) this.unsubscribeLogs();
    if (this.unsubscribeStats) this.unsubscribeStats();
    if (this.chart) this.chart.destroy();
  }

  onViewChange(ev: CustomEvent<SegmentChangeEventDetail>): void {
    this.viewMode = ev.detail.value as ViewMode;
    this.refreshChart();
  }

  onBarangayDetailsChange(): void {
  this.updateLearnedDetails();
}

  private listenToSummaryStats(): void {
    const logsRef = collection(this.firestore, 'ml_delivery_logs');
    this.unsubscribeLogs = onSnapshot(logsRef, (snap) => {
      const rawLogs = snap.docs.map((d) => d.data() as any);

      const validLogs: DeliveryLogRow[] = rawLogs
        .map((log) => {
          const barangayRaw = (log.barangay || '').toString().trim();
          const barangay =
            barangayRaw && barangayRaw.toLowerCase() !== 'unknown'
              ? barangayRaw
              : 'Unknown Area (No Learned Barangay Yet)';

          return {
            barangay,
            durationMinutes: Number(log.durationMinutes || 0),
            predictedMinutes: Number(log.predictedMinutes || 0),
            predictionError: Number(log.predictionError),
            distanceKm: Number(log.distanceKm || 0),
            itemCount: Number(log.itemCount || 0),
            hourBucket: (log.hourBucket || '').toString().trim().toLowerCase(),
          };
        })
        .filter((log) => {
          return (
            log.durationMinutes > 0 &&
            log.durationMinutes <= 180 &&
            log.predictedMinutes > 0 &&
            log.predictedMinutes <= 180 &&
            Number.isFinite(log.predictionError)
          );
        });

      this.logs = validLogs;
      this.totalLoggedDeliveries = rawLogs.length;

      if (validLogs.length > 0) {
        const totalError = validLogs.reduce((sum, log) => {
          return sum + Math.abs(log.predictionError);
        }, 0);

        this.averagePredictionError = Number((totalError / validLogs.length).toFixed(1));
      } else {
        this.averagePredictionError = 0;
      }

this.updateLearnedDetails();

// ✅ REPLACE THIS LINE
setTimeout(() => this.refreshChart(), 100);
    });

    const statsRef = collection(this.firestore, 'ml_stats');
    this.unsubscribeStats = onSnapshot(statsRef, (snap) => {
const rows: StatsRow[] = snap.docs.map((d) => {
  const data = d.data() as any;
  const rawBarangay = (data.barangay || d.id || '').toString().trim();
  const barangay =
    rawBarangay && rawBarangay !== 'Unknown'
      ? rawBarangay
      : 'Unknown Area (No Learned Barangay Yet)';

  return {
    barangay,
    avgMinutes: Number(data.avgMinutes || 0),
    totalTrips: Number(data.totalTrips || 0),
  };
});

      console.log('ML Stats rows:', rows);

      const filtered = rows.filter((r) => r.totalTrips > 0 && r.avgMinutes > 0);
      filtered.sort((a, b) => a.avgMinutes - b.avgMinutes);

      this.statsRows = filtered;
      this.barangayOptions = filtered.map((row) => row.barangay);

      if (filtered.length) {
        const best = filtered[0];
        this.bestBarangay = best.barangay;

        if (!this.selectedBarangay || this.selectedBarangay === 'N/A') {
          this.selectedBarangay = 'ALL';
        }

        this.selectedBarangayAvgMinutes = Number(best.avgMinutes.toFixed(1));
        this.selectedBarangayTrips = best.totalTrips;
      } else {
        this.bestBarangay = 'N/A';
        this.selectedBarangay = 'ALL';
        this.selectedBarangayAvgMinutes = 0;
        this.selectedBarangayTrips = 0;
      }

this.updateLearnedDetails();

// ✅ REPLACE THIS LINE
setTimeout(() => this.refreshChart(), 100);
    });
  }

  private updateLearnedDetails(): void {
    if (!this.logs.length) {
      this.averageDistanceKm = 0;
      this.averageItemCount = 0;
      this.morningAverageMinutes = 0;
      this.afternoonAverageMinutes = 0;
      this.eveningAverageMinutes = 0;

      if (!this.statsRows.length) {
        this.selectedBarangay = 'N/A';
        this.selectedBarangayAvgMinutes = 0;
        this.selectedBarangayTrips = 0;
      }

      return;
    }

const selectedLogs =
  this.selectedBarangay === 'ALL' || !this.selectedBarangay || this.selectedBarangay === 'N/A'
    ? this.logs
    : this.logs.filter((log) => log.barangay === this.selectedBarangay);

const validDistanceLogs = selectedLogs.filter((log) => log.distanceKm >= 0);
if (validDistanceLogs.length) {
  const totalDistance = validDistanceLogs.reduce((sum, log) => sum + log.distanceKm, 0);
  this.averageDistanceKm = Number((totalDistance / validDistanceLogs.length).toFixed(2));
} else {
  this.averageDistanceKm = 0;
}

if (selectedLogs.length) {
  const totalItems = selectedLogs.reduce((sum, log) => sum + Math.max(0, log.itemCount), 0);
  this.averageItemCount = Number((totalItems / selectedLogs.length).toFixed(1));
} else {
  this.averageItemCount = 0;
}

    this.morningAverageMinutes = this.getAverageMinutesByHourBucket('morning', selectedLogs);
    this.afternoonAverageMinutes = this.getAverageMinutesByHourBucket('afternoon', selectedLogs);
    this.eveningAverageMinutes = this.getAverageMinutesByHourBucket('evening', selectedLogs);

if (this.selectedBarangay === 'ALL') {
  const totalMinutes = selectedLogs.reduce((sum, log) => sum + log.durationMinutes, 0);
  this.selectedBarangayAvgMinutes = selectedLogs.length
    ? Number((totalMinutes / selectedLogs.length).toFixed(1))
    : 0;
  this.selectedBarangayTrips = selectedLogs.length;
} else if (this.selectedBarangay !== 'N/A') {
  const barangayLogs = this.logs.filter((log) => log.barangay === this.selectedBarangay);
  if (barangayLogs.length) {
    const totalMinutes = barangayLogs.reduce((sum, log) => sum + log.durationMinutes, 0);
    this.selectedBarangayAvgMinutes = Number((totalMinutes / barangayLogs.length).toFixed(1));
    this.selectedBarangayTrips = barangayLogs.length;
  } else {
    this.selectedBarangayAvgMinutes = 0;
    this.selectedBarangayTrips = 0;
  }
}
  }

private getAverageMinutesByHourBucket(bucket: string, sourceLogs: DeliveryLogRow[]): number {
  const filtered = sourceLogs.filter(
    (log) => log.hourBucket === bucket && log.durationMinutes > 0
  );

  if (!filtered.length) return 0;

  const total = filtered.reduce((sum, log) => sum + log.durationMinutes, 0);
  return Number((total / filtered.length).toFixed(1));
}

  private loadChart(
    chartType: 'bar' | 'line' = 'bar',
    labels: string[] = [],
    datasets: any[] = [],
    title: string = 'AquaRoute ML Visualization'
  ): void {
    const canvas = this.mlChartCanvas?.nativeElement;
    if (!canvas) {
      setTimeout(() => this.loadChart(chartType, labels, datasets, title), 150);
      return;
    }

    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }

const hasData =
  labels.length > 0 &&
  datasets.length > 0 &&
  !datasets.every((d) => !d.data?.length);

  console.log('Rendering chart:', {
  labels,
  datasets,
  viewMode: this.viewMode
});

this.chartEmpty = !hasData;
this.chartReady = hasData;
this.chartTitle = title;

if (!hasData) {
  console.warn('⚠️ Chart has no valid data:', { labels, datasets });
  return;
}

    console.log('Drawing chart with:', { title, labels, datasets, chartEmpty: this.chartEmpty });

    this.chart = new Chart(canvas, {
      type: chartType,
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: {
              color: '#000',
              font: { size: 13, weight: 'bold' as const },
            },
          },
          title: {
            display: true,
            text: title,
            color: '#2F80ED',
            font: { size: 16, weight: 'bold' as const },
          },
          tooltip: {
            enabled: true,
          },
        },
        scales: {
          x: {
            title: {
              display: true,
              text: this.xAxisLabel,
              color: '#333',
              font: { size: 12, weight: 'bold' as const },
            },
            ticks: {
              color: '#333',
              font: { size: 10 },
              maxRotation: 35,
              minRotation: 0,
              autoSkip: true,
              maxTicksLimit: 6,
            },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: this.yAxisLabel,
              color: '#333',
              font: { size: 12, weight: 'bold' as const },
            },
            ticks: {
              color: '#333',
              font: { size: 12 },
            },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
        },
      },
    });
  }

  private async refreshChart(): Promise<void> {
    if (this.viewMode === 'barangay') {
      this.renderBarangayChart();
    } else if (this.viewMode === 'actual_vs_predicted') {
      await this.renderActualVsPredictedChart();
    } else {
      this.renderFeatureImportanceChart();
    }
  }

  private renderBarangayChart(): void {
    const rows = [...this.statsRows]
      .sort((a, b) => a.avgMinutes - b.avgMinutes)
      .slice(0, 10)
      .map((row) => ({
        label: row.barangay,
        value: Number(row.avgMinutes.toFixed(1)),
      }));

    this.chartTitle = 'Average Delivery Time by Area (Minutes)';
    this.chartEmptyMessage = 'No trained barangay data yet. Complete more deliveries first.';
    this.chartLegendTitle = 'How to Read This Chart';
    this.chartLegendText =
      'Each bar shows the average delivery time in minutes for one barangay. Lower bars mean faster average deliveries, while higher bars mean slower average deliveries in that area.';
    this.chartAnalysisTitle = 'What This Means';
    this.chartAnalysis =
      rows.length > 0
        ? `This chart compares learned average delivery time across barangays. The fastest learned area currently shown is ${rows[0].label}, while areas with higher bars have slower average delivery times.`
        : 'This chart will appear once the system has enough completed deliveries to learn delivery patterns per barangay.';
    this.xAxisLabel = 'Barangay / Area';
    this.yAxisLabel = 'Average Time (mins)';

    this.loadChart(
      'bar',
      rows.map((r) => r.label),
      [
        {
          label: 'Average Delivery Time (mins)',
          data: rows.map((r) => r.value),
          borderWidth: 2,
          borderRadius: 8,
        },
      ],
      this.chartTitle
    );
  }

  private async renderActualVsPredictedChart(): Promise<void> {
    const dataset = await this.mlWeightService.getActualVsPredicted(10);

    this.chartTitle = 'Actual vs Predicted Delivery Time (Minutes)';
    this.chartEmptyMessage =
      'No valid actual vs predicted logs yet. Complete more deliveries to populate this chart.';
    this.chartLegendTitle = 'How to Read This Chart';
    this.chartLegendText =
      'This chart compares the actual recorded delivery time and the predicted delivery time for recent completed deliveries. The closer the two lines are, the more accurate the system prediction is.';
    this.chartAnalysisTitle = 'What This Means';
    this.chartAnalysis =
      dataset.labels.length > 0
        ? 'This chart compares the system’s predicted delivery time with the actual result. Smaller gaps mean better prediction accuracy, while larger gaps show deliveries where the model still needs improvement.'
        : 'This chart will appear after the system collects valid delivery logs with both actual and predicted delivery time values.';
    this.xAxisLabel = 'Recent Deliveries';
    this.yAxisLabel = 'Time (mins)';

const shortLabels = dataset.labels.map((label, index) => `#${index + 1}`);

this.loadChart(
  'line',
  shortLabels,
      [
        {
          label: 'Actual Delivery Time',
          data: dataset.actual,
          borderWidth: 3,
          tension: 0.25,
        },
        {
          label: 'Predicted Delivery Time',
          data: dataset.predicted,
          borderWidth: 3,
          tension: 0.25,
        },
      ],
      this.chartTitle
    );
  }

  private renderFeatureImportanceChart(): void {
    const values = [
      this.averageDistanceKm,
      this.averageItemCount,
      this.morningAverageMinutes,
      this.afternoonAverageMinutes,
      this.eveningAverageMinutes,
    ];

    const hasNonZeroValues = values.some((value) => Number(value) > 0);

    this.chartTitle = 'Learned Delivery Observations';
    this.chartEmptyMessage =
      'Learned delivery observations will appear once more completed deliveries are logged.';
    this.chartLegendTitle = 'How to Read This Chart';
    this.chartLegendText =
      'This chart shows real learned observations from delivery logs. It compares average distance in kilometers, average item count, and average delivery time by time of day.';
    this.chartAnalysisTitle = 'What This Means';
    this.chartAnalysis = hasNonZeroValues
      ? 'This chart summarizes the delivery patterns learned from completed transactions. It helps show how distance, order size, and time of day relate to delivery performance using real observed values instead of abstract multipliers.'
      : 'This chart will become meaningful after more completed deliveries are logged and the model has enough historical data to learn from.';
    this.xAxisLabel = 'Learned Details';
    this.yAxisLabel = 'Observed Value';

    this.loadChart(
      'bar',
hasNonZeroValues
  ? [
      'Distance (km)',
      'Items',
      'Morning (mins)',
      'Afternoon (mins)',
      'Evening (mins)',
    ]
  : [],
      hasNonZeroValues
        ? [
            {
              label: 'Observed Delivery Data',
              data: values,
              borderWidth: 2,
              borderRadius: 8,
            },
          ]
        : [],
      this.chartTitle
    );
  }
  ngAfterViewInit(): void {
  setTimeout(() => {
    this.refreshChart();
  }, 200);
}
}