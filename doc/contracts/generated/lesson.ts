/* Generated from doc/specs. Run npm run contracts:generate. */

export type Activity =
  | {
      id: string;
      type: 'multiple_choice';
      prompt: LocalizedText;
      content: {
        /**
         * @minItems 2
         * @maxItems 12
         */
        options: {
          id: string;
          text: LocalizedText;
        }[];
        multiple: boolean;
      };
      /**
       * @minItems 1
       * @maxItems 12
       */
      correct_answers: string[];
      feedback: {
        correct: LocalizedText;
        incorrect: LocalizedText;
        hint: LocalizedText;
      };
      points: number;
      difficulty: 'easy' | 'medium' | 'hard';
      scoring: 'exact' | 'partial';
      /**
       * @minItems 0
       * @maxItems 4
       */
      media?: {
        asset_id: string;
        kind: 'image' | 'audio';
        alt: LocalizedText;
      }[];
    }
  | {
      id: string;
      type: 'true_false';
      prompt: LocalizedText;
      content: {
        statement: LocalizedText;
      };
      correct_answers: boolean;
      feedback: {
        correct: LocalizedText;
        incorrect: LocalizedText;
        hint: LocalizedText;
      };
      points: number;
      difficulty: 'easy' | 'medium' | 'hard';
      scoring: 'exact' | 'partial';
      /**
       * @minItems 0
       * @maxItems 4
       */
      media?: {
        asset_id: string;
        kind: 'image' | 'audio';
        alt: LocalizedText;
      }[];
    }
  | {
      id: string;
      type: 'fill_in_the_blank';
      prompt: LocalizedText;
      content: {
        /**
         * @minItems 1
         * @maxItems 8
         */
        blanks: {
          id: string;
          label: LocalizedText;
        }[];
      };
      correct_answers: {
        /**
         * @minItems 1
         * @maxItems 8
         */
        [k: string]: string[];
      };
      feedback: {
        correct: LocalizedText;
        incorrect: LocalizedText;
        hint: LocalizedText;
      };
      points: number;
      difficulty: 'easy' | 'medium' | 'hard';
      scoring: 'exact' | 'partial';
      /**
       * @minItems 0
       * @maxItems 4
       */
      media?: {
        asset_id: string;
        kind: 'image' | 'audio';
        alt: LocalizedText;
      }[];
    }
  | {
      id: string;
      type: 'drag_to_match';
      prompt: LocalizedText;
      content: {
        /**
         * @minItems 2
         * @maxItems 12
         */
        left: {
          id: string;
          text: LocalizedText;
        }[];
        /**
         * @minItems 2
         * @maxItems 12
         */
        right: {
          id: string;
          text: LocalizedText;
        }[];
      };
      correct_answers: {
        [k: string]: string;
      };
      feedback: {
        correct: LocalizedText;
        incorrect: LocalizedText;
        hint: LocalizedText;
      };
      points: number;
      difficulty: 'easy' | 'medium' | 'hard';
      scoring: 'exact' | 'partial';
      /**
       * @minItems 0
       * @maxItems 4
       */
      media?: {
        asset_id: string;
        kind: 'image' | 'audio';
        alt: LocalizedText;
      }[];
    }
  | {
      id: string;
      type: 'categorize';
      prompt: LocalizedText;
      content: {
        /**
         * @minItems 2
         * @maxItems 16
         */
        items: {
          id: string;
          text: LocalizedText;
        }[];
        /**
         * @minItems 2
         * @maxItems 8
         */
        categories: {
          id: string;
          text: LocalizedText;
        }[];
      };
      correct_answers: {
        [k: string]: string;
      };
      feedback: {
        correct: LocalizedText;
        incorrect: LocalizedText;
        hint: LocalizedText;
      };
      points: number;
      difficulty: 'easy' | 'medium' | 'hard';
      scoring: 'exact' | 'partial';
      /**
       * @minItems 0
       * @maxItems 4
       */
      media?: {
        asset_id: string;
        kind: 'image' | 'audio';
        alt: LocalizedText;
      }[];
    }
  | {
      id: string;
      type: 'sequencing';
      prompt: LocalizedText;
      content: {
        /**
         * @minItems 2
         * @maxItems 12
         */
        items: {
          id: string;
          text: LocalizedText;
        }[];
      };
      /**
       * @minItems 2
       * @maxItems 12
       */
      correct_answers: string[];
      feedback: {
        correct: LocalizedText;
        incorrect: LocalizedText;
        hint: LocalizedText;
      };
      points: number;
      difficulty: 'easy' | 'medium' | 'hard';
      scoring: 'exact' | 'partial';
      /**
       * @minItems 0
       * @maxItems 4
       */
      media?: {
        asset_id: string;
        kind: 'image' | 'audio';
        alt: LocalizedText;
      }[];
    }
  | {
      id: string;
      type: 'label_diagram';
      prompt: LocalizedText;
      content: {
        image: {
          asset_id: string;
          kind: 'image' | 'audio';
          alt: LocalizedText;
        };
        /**
         * @minItems 1
         * @maxItems 12
         */
        regions: {
          id: string;
          label: LocalizedText;
          x: number;
          y: number;
        }[];
      };
      correct_answers: {
        /**
         * @minItems 1
         * @maxItems 8
         */
        [k: string]: string[];
      };
      feedback: {
        correct: LocalizedText;
        incorrect: LocalizedText;
        hint: LocalizedText;
      };
      points: number;
      difficulty: 'easy' | 'medium' | 'hard';
      scoring: 'exact' | 'partial';
      /**
       * @minItems 0
       * @maxItems 4
       */
      media?: {
        asset_id: string;
        kind: 'image' | 'audio';
        alt: LocalizedText;
      }[];
    }
  | {
      id: string;
      type: 'memory_cards';
      prompt: LocalizedText;
      content: {
        /**
         * @minItems 2
         * @maxItems 24
         */
        cards: {
          id: string;
          text: LocalizedText;
        }[];
      };
      /**
       * @minItems 1
       * @maxItems 12
       */
      correct_answers: {
        first: string;
        second: string;
      }[];
      feedback: {
        correct: LocalizedText;
        incorrect: LocalizedText;
        hint: LocalizedText;
      };
      points: number;
      difficulty: 'easy' | 'medium' | 'hard';
      scoring: 'exact' | 'partial';
      /**
       * @minItems 0
       * @maxItems 4
       */
      media?: {
        asset_id: string;
        kind: 'image' | 'audio';
        alt: LocalizedText;
      }[];
    }
  | {
      id: string;
      type: 'word_builder';
      prompt: LocalizedText;
      content: {
        /**
         * @minItems 2
         * @maxItems 24
         */
        pieces: {
          id: string;
          text: LocalizedText;
        }[];
      };
      /**
       * @minItems 1
       * @maxItems 12
       */
      correct_answers: string[][];
      feedback: {
        correct: LocalizedText;
        incorrect: LocalizedText;
        hint: LocalizedText;
      };
      points: number;
      difficulty: 'easy' | 'medium' | 'hard';
      scoring: 'exact' | 'partial';
      /**
       * @minItems 0
       * @maxItems 4
       */
      media?: {
        asset_id: string;
        kind: 'image' | 'audio';
        alt: LocalizedText;
      }[];
    }
  | {
      id: string;
      type: 'number_line';
      prompt: LocalizedText;
      content: {
        min: number;
        max: number;
        step: number;
        tolerance: number;
      };
      /**
       * @minItems 1
       * @maxItems 12
       */
      correct_answers: number[];
      feedback: {
        correct: LocalizedText;
        incorrect: LocalizedText;
        hint: LocalizedText;
      };
      points: number;
      difficulty: 'easy' | 'medium' | 'hard';
      scoring: 'exact' | 'partial';
      /**
       * @minItems 0
       * @maxItems 4
       */
      media?: {
        asset_id: string;
        kind: 'image' | 'audio';
        alt: LocalizedText;
      }[];
    };

export interface Lesson {
  id: string;
  schema_version: '1.0.0';
  metadata: {
    title: LocalizedText;
    subject: string;
    grade_id: string;
    age_range: {
      min: number;
      max: number;
    };
    language: string;
    direction: 'ltr' | 'rtl';
    country: string;
    curriculum_id: string;
    /**
     * @minItems 1
     * @maxItems 12
     */
    curriculum_refs: string[];
    reading_level: 'emerging' | 'developing' | 'independent';
    estimated_minutes: number;
    /**
     * @minItems 1
     * @maxItems 8
     */
    learning_objectives: LocalizedText[];
  };
  /**
   * @minItems 1
   * @maxItems 12
   */
  sections: {
    id: string;
    title: LocalizedText;
    /**
     * @minItems 0
     * @maxItems 20
     */
    blocks: (
      | {
          type: 'text';
          text: LocalizedText;
        }
      | {
          type: 'tip';
          text: LocalizedText;
        }
      | {
          type: 'example';
          text: LocalizedText;
        }
      | {
          type: 'read_aloud';
          text: LocalizedText;
        }
      | {
          type: 'image';
          media: {
            asset_id: string;
            kind: 'image' | 'audio';
            alt: LocalizedText;
          };
        }
      | {
          type: 'vocabulary';
          term: LocalizedText;
          definition: LocalizedText;
        }
    )[];
    /**
     * @minItems 1
     * @maxItems 12
     */
    activities: Activity[];
  }[];
}
export interface LocalizedText {
  /**
   * This interface was referenced by `LocalizedText`'s JSON-Schema definition
   * via the `patternProperty` "^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$".
   */
  [k: string]: string;
}
