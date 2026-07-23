import { Reveal } from './Reveal';
import { ProjectDiagram } from './ResearchDiagrams';

/**
 * Scene 03.5 — AI Research Projects (inserted between Fields of Exploration and
 * From Signals to Understanding).
 *
 * An applied-AI research portfolio: eight independent research and development
 * projects completed by the team. Presented as research explorations only — no
 * client, deployment, location, publication, funding or performance claims. All
 * project content is real, readable text; the abstract diagrams are decorative
 * (aria-hidden) and never the sole carrier of meaning. Fully understandable
 * without animation or hover, and reduced-motion aware via the shared Reveal /
 * global motion rules. The section sits above the fixed WebGL layer, which holds
 * the globe in its calm, receded pose across this range (no new 3D timeline).
 */

type Project = {
  number: string;
  title: string;
  description: string;
  labels: readonly string[];
};

const PROJECTS: readonly Project[] = [
  {
    number: '01',
    title: 'Crowd Detection and Management',
    description:
      'A computer-vision research system designed to analyse crowd density, movement patterns and congestion zones from visual feeds, helping identify unusual gatherings and emerging crowd-safety risks.',
    labels: ['Computer Vision', 'Density Estimation', 'Movement Analysis', 'Risk Detection'],
  },
  {
    number: '02',
    title: 'Road Accident Detection',
    description:
      'An applied video-intelligence project exploring automated identification of road collisions, stalled vehicles and abnormal traffic events from camera footage.',
    labels: ['Video Analytics', 'Event Detection', 'Traffic Intelligence', 'Automated Alerts'],
  },
  {
    number: '03',
    title: 'Wildfire and Smoke Detection',
    description:
      'An early-warning vision system designed to detect visual indicators of smoke, fire and developing wildfire activity from image or video streams.',
    labels: ['Early Warning', 'Image Classification', 'Environmental AI', 'Threat Monitoring'],
  },
  {
    number: '04',
    title: 'Flood Prediction and Mapping',
    description:
      'A geospatial modelling project exploring the use of environmental, topographic and predictive data to identify flood-prone regions and generate interpretable risk maps.',
    labels: ['Predictive Modelling', 'Geospatial Intelligence', 'Risk Mapping', 'Environmental Data'],
  },
  {
    number: '05',
    title: 'Cross-Domain Text Classification',
    description:
      'A natural-language processing project designed to classify text accurately across multiple subject domains while adapting to differences in vocabulary, context and writing style.',
    labels: ['Natural Language Processing', 'Domain Adaptation', 'Semantic Analysis', 'Text Classification'],
  },
  {
    number: '06',
    title: 'High-Speed Self-Driving Car Optimization',
    description:
      'An autonomous-systems research project focused on improving high-speed driving decisions through trajectory planning, vehicle-control optimisation and rapid environmental response.',
    labels: ['Autonomous Systems', 'Trajectory Planning', 'Control Optimization', 'Real-Time Decisioning'],
  },
  {
    number: '07',
    title: 'Deepfake Detection',
    description:
      'A digital-forensics research project designed to identify manipulated visual and audiovisual content by analysing inconsistencies in facial behaviour, image structure and temporal patterns.',
    labels: ['Digital Forensics', 'Media Integrity', 'Visual Analysis', 'Anomaly Detection'],
  },
  {
    number: '08',
    title: 'Emotion Recognition from Speech',
    description:
      'An audio-intelligence research project exploring how vocal characteristics such as tone, pitch, rhythm and energy can be analysed to identify emotional patterns in speech.',
    labels: ['Speech Intelligence', 'Audio Analysis', 'Feature Extraction', 'Pattern Recognition'],
  },
];

/** Thin up-right marker that brightens and drifts subtly on card hover. */
function ProjectMarker() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-4 w-4 text-ol-muted transition-all duration-500 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ol-gold"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 11 L11 5" />
      <path d="M6 5 H11 V10" />
    </svg>
  );
}

function ProjectCard({ project, index }: { project: Project; index: number }) {
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-[var(--ol-border)] bg-[rgba(12,13,18,0.5)] p-7 transition-[transform,border-color,box-shadow] duration-500 ease-out hover:-translate-y-1 hover:border-ol-gold/40 hover:shadow-[0_20px_60px_-28px_rgba(214,161,58,0.55)] md:p-8">
      {/* Number + directional marker */}
      <div className="mb-6 flex items-center justify-between">
        <span className="font-sans text-[12px] tabular-nums tracking-[0.22em] text-ol-gold/70 transition-colors duration-500 group-hover:text-ol-gold">
          {project.number}
        </span>
        <ProjectMarker />
      </div>

      {/* Abstract technical illustration — decorative, brightens slightly on hover. */}
      <div className="mb-7 opacity-80 transition-opacity duration-500 group-hover:opacity-100">
        <div className="aspect-[300/132] w-full">
          <ProjectDiagram index={index} />
        </div>
      </div>

      <h3 className="ol-display text-2xl leading-tight text-ol-ivory sm:text-[1.7rem]">
        {project.title}
      </h3>

      <p className="mt-3 text-[15px] leading-relaxed text-ol-text-secondary">
        {project.description}
      </p>

      {/* Capability labels — always visible; become more prominent on hover. */}
      <ul className="mt-auto flex flex-wrap gap-2 pt-7" aria-label="Capabilities">
        {project.labels.map((label) => (
          <li
            key={label}
            className="rounded-full border border-[var(--ol-border)] px-3 py-1 font-sans text-[11px] uppercase tracking-[0.1em] text-ol-muted transition-colors duration-500 group-hover:border-ol-gold/30 group-hover:text-ol-text-secondary"
          >
            {label}
          </li>
        ))}
      </ul>
    </article>
  );
}

export function SectionResearch() {
  return (
    <section
      id="research"
      aria-label="AI Research Projects"
      className="relative px-6 py-32"
    >
      <div className="mx-auto w-full max-w-6xl">
        <Reveal>
          <p className="ol-eyebrow">AI Research Projects</p>
          <h2 className="ol-display ol-h2 mt-5 max-w-3xl text-ol-ivory">
            Intelligence built across complex domains.
          </h2>
          <p className="ol-body ol-measure-wide mt-7">
            A portfolio of applied-AI research projects spanning computer vision, predictive
            modelling, autonomous systems, language intelligence, audio analysis and digital-content
            verification.
          </p>
          <p className="ol-body ol-measure-wide mt-4 text-ol-text-secondary/80">
            Each project explores how machine intelligence can interpret complex signals, identify
            emerging risks and support faster, more informed decisions.
          </p>
        </Reveal>

        <ol className="mt-16 grid grid-cols-1 gap-x-8 gap-y-12 sm:mt-20 md:grid-cols-2 md:gap-x-10 md:gap-y-16">
          {PROJECTS.map((project, i) => (
            <li key={project.number} className={`h-full ${i % 2 === 1 ? 'md:translate-y-12' : ''}`}>
              <Reveal className="h-full" delay={(i % 2) * 0.06}>
                <ProjectCard project={project} index={i} />
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
