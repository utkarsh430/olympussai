'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import {
  OUTCOME_LABEL,
  type GalleryCorridorModel,
  type GalleryModel,
  type ScenarioCardModel,
  type ScenarioFamily,
  type ScenarioOutcome,
} from '@/lib/showcase/resolve';
import { cn } from '@/lib/utils';
import { SceneHeader } from './SceneHeader';
import { Sparkline } from './Sparkline';

type Filter = 'all' | ScenarioFamily;

const MINUS = '−';